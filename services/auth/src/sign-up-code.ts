import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { AuthContext, BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import * as z from "zod";

// No account exists until /sign-up/email succeeds with a valid code. send-code
// answers the same for every address so it can't be used to find out who's
// registered.

const CODE_TTL_SECONDS = 10 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const SIGN_UP_PATH = "/sign-up/email";

export interface SignUpCodeOptions {
    sendCode: (email: string, code: string) => Promise<void>;
    sendExistingAccount: (user: { email: string; name: string }) => Promise<void>;
}

const codeId = (email: string) => `sign-up-code:${email}`;
const noticeId = (email: string) => `sign-up-notice:${email}`;
const normalize = (email: string) => email.trim().toLowerCase();

const fail = (code: string, message: string) => new APIError("BAD_REQUEST", { code, message });

const hashCode = (secret: string, email: string, code: string) =>
    createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");

// Stops the endpoint being used to flood someone's inbox.
async function recentlySent(ctx: AuthContext, id: string, ttlSeconds: number): Promise<boolean> {
    const record = await ctx.internalAdapter.findVerificationValue(id);
    if (!record) return false;
    const sentAt = new Date(record.expiresAt).getTime() - ttlSeconds * 1000;
    return Date.now() - sentAt < RESEND_COOLDOWN_SECONDS * 1000;
}

async function replaceRecord(ctx: AuthContext, id: string, value: string, ttlSeconds: number) {
    await ctx.internalAdapter.deleteVerificationByIdentifier(id);
    await ctx.internalAdapter.createVerificationValue({
        identifier: id,
        value,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    });
}

async function checkCode(ctx: AuthContext, email: string, code: unknown): Promise<void> {
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
        throw fail("INVALID_CODE", "Invalid code");
    }

    const id = codeId(email);
    const record = await ctx.internalAdapter.findVerificationValue(id);
    if (!record) throw fail("INVALID_CODE", "Invalid code");

    if (new Date(record.expiresAt).getTime() < Date.now()) {
        await ctx.internalAdapter.deleteVerificationByIdentifier(id);
        throw fail("CODE_EXPIRED", "Code expired");
    }

    const [hash, attemptsText] = record.value.split(":");
    const attempts = Number(attemptsText) || 0;
    if (attempts >= MAX_ATTEMPTS) {
        await ctx.internalAdapter.deleteVerificationByIdentifier(id);
        throw fail("TOO_MANY_ATTEMPTS", "Too many attempts");
    }

    const expected = Buffer.from(hash, "hex");
    const actual = Buffer.from(hashCode(ctx.secret, email, code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        await ctx.internalAdapter.updateVerificationByIdentifier(id, {
            value: `${hash}:${attempts + 1}`,
        });
        throw fail("INVALID_CODE", "Invalid code");
    }
}

export const signUpCode = (options: SignUpCodeOptions) =>
    ({
        id: "sign-up-code",

        endpoints: {
            sendSignUpCode: createAuthEndpoint(
                "/sign-up/send-code",
                { method: "POST", body: z.object({ email: z.string() }) },
                async (ctx) => {
                    const email = normalize(ctx.body.email);
                    if (!z.email().safeParse(email).success) {
                        throw fail("INVALID_EMAIL", "Invalid email");
                    }

                    const existing = await ctx.context.internalAdapter.findUserByEmail(email);
                    if (existing) {
                        if (!(await recentlySent(ctx.context, noticeId(email), RESEND_COOLDOWN_SECONDS))) {
                            await replaceRecord(ctx.context, noticeId(email), "sent", RESEND_COOLDOWN_SECONDS);
                            await options.sendExistingAccount(existing.user);
                        }
                        return ctx.json({ success: true });
                    }

                    if (await recentlySent(ctx.context, codeId(email), CODE_TTL_SECONDS)) {
                        return ctx.json({ success: true });
                    }

                    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
                    await replaceRecord(
                        ctx.context,
                        codeId(email),
                        `${hashCode(ctx.context.secret, email, code)}:0`,
                        CODE_TTL_SECONDS,
                    );
                    await options.sendCode(email, code);
                    return ctx.json({ success: true });
                },
            ),

            verifySignUpCode: createAuthEndpoint(
                "/sign-up/verify-code",
                { method: "POST", body: z.object({ email: z.string(), code: z.string() }) },
                async (ctx) => {
                    await checkCode(ctx.context, normalize(ctx.body.email), ctx.body.code);
                    return ctx.json({ success: true });
                },
            ),
        },

        hooks: {
            before: [
                {
                    matcher: (ctx) => ctx.path === SIGN_UP_PATH,
                    handler: createAuthMiddleware(async (ctx) => {
                        const email: unknown = ctx.body?.email;
                        if (typeof email !== "string") return;
                        await checkCode(ctx.context, normalize(email), ctx.body?.code);
                    }),
                },
            ],
        },

        init: () => ({
            options: {
                databaseHooks: {
                    user: {
                        create: {
                            // Only reached once the before hook accepted the code.
                            before: async (user, ctx) => {
                                if (ctx?.path !== SIGN_UP_PATH) return;
                                return { data: { ...user, emailVerified: true } };
                            },
                            after: async (user, ctx) => {
                                if (ctx?.path !== SIGN_UP_PATH) return;
                                await ctx.context.internalAdapter.deleteVerificationByIdentifier(
                                    codeId(normalize(user.email)),
                                );
                            },
                        },
                    },
                },
            },
        }),

        // Only applies where Better Auth's rate limiter is on (production by default).
        rateLimit: [
            { pathMatcher: (path) => path === "/sign-up/send-code", window: 60, max: 3 },
            { pathMatcher: (path) => path === "/sign-up/verify-code", window: 60, max: 10 },
        ],
    }) satisfies BetterAuthPlugin;
