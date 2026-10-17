import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { accountRules } from "./account-rules.js";

const BASE_URL = "http://localhost:3000";
const TINY_WEBP = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

function setup() {
    const db: Record<string, Record<string, unknown>[]> = {
        user: [],
        session: [],
        account: [],
        verification: [],
    };
    const resetUrls: string[] = [];

    const auth = betterAuth({
        baseURL: BASE_URL,
        basePath: "/api/auth",
        secret: "test-secret-that-is-at-least-32-characters-long",
        database: memoryAdapter(db),
        logger: { disabled: true },
        emailAndPassword: {
            enabled: true,
            revokeSessionsOnPasswordReset: true,
            sendResetPassword: async ({ url }) => void resetUrls.push(url),
        },
        plugins: [accountRules()],
    });

    async function request(method: string, path: string, body?: object, cookie?: string) {
        const res = await auth.handler(
            new Request(path.startsWith("http") ? path : `${BASE_URL}/api/auth${path}`, {
                method,
                headers: {
                    "content-type": "application/json",
                    origin: BASE_URL,
                    ...(cookie && { cookie }),
                },
                body: body && JSON.stringify(body),
                redirect: "manual",
            }),
        );
        const json = await res.clone().json().catch(() => null);
        return {
            status: res.status,
            code: json?.code as string | undefined,
            location: res.headers.get("location"),
            cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
        };
    }

    async function signUp(password = "password1") {
        const res = await request("POST", "/sign-up/email", {
            name: "Test",
            email: "user@example.com",
            password,
        });
        return res.cookie;
    }

    return { db, resetUrls, request, signUp };
}

describe("password strength", () => {
    it("rejects a password without a number on sign-up", async () => {
        const { request } = setup();
        expect(
            await request("POST", "/sign-up/email", {
                name: "Test",
                email: "user@example.com",
                password: "password",
            }),
        ).toMatchObject({ code: "PASSWORD_TOO_WEAK" });
    });

    it("applies to change-password", async () => {
        const { request, signUp } = setup();
        const cookie = await signUp();
        expect(
            await request(
                "POST",
                "/change-password",
                { currentPassword: "password1", newPassword: "12345678" },
                cookie,
            ),
        ).toMatchObject({ code: "PASSWORD_TOO_WEAK" });
    });
});

describe("password reset", () => {
    it("emails a link that resets the password once and signs out other sessions", async () => {
        const { db, resetUrls, request, signUp } = setup();
        await signUp();
        expect(db.session).toHaveLength(1);

        await request("POST", "/request-password-reset", {
            email: "user@example.com",
            redirectTo: "/login?reset=1",
        });
        expect(resetUrls).toHaveLength(1);

        const link = await request("GET", resetUrls[0]);
        const redirect = new URL(link.location ?? "", BASE_URL);
        expect(redirect.pathname).toBe("/login");
        expect(redirect.searchParams.get("reset")).toBe("1");
        const token = redirect.searchParams.get("token") ?? "";

        expect(
            await request("POST", "/reset-password", { token, newPassword: "weakpassword" }),
        ).toMatchObject({ code: "PASSWORD_TOO_WEAK" });

        expect(
            (await request("POST", "/reset-password", { token, newPassword: "newpassword2" })).status,
        ).toBe(200);
        expect(db.session).toHaveLength(0);

        expect(
            (await request("POST", "/sign-in/email", { email: "user@example.com", password: "newpassword2" }))
                .status,
        ).toBe(200);
        expect(
            await request("POST", "/reset-password", { token, newPassword: "another3pass" }),
        ).toMatchObject({ code: "INVALID_TOKEN" });
    });

    it("answers the same for an unknown email and sends nothing", async () => {
        const { resetUrls, request } = setup();
        expect(
            (await request("POST", "/request-password-reset", { email: "nobody@example.com" })).status,
        ).toBe(200);
        expect(resetUrls).toHaveLength(0);
    });
});

describe("avatar", () => {
    it("accepts a small image data URL, and removing it", async () => {
        const { db, request, signUp } = setup();
        const cookie = await signUp();

        expect((await request("POST", "/update-user", { image: TINY_WEBP }, cookie)).status).toBe(200);
        expect(db.user[0].image).toBe(TINY_WEBP);

        expect((await request("POST", "/update-user", { image: null }, cookie)).status).toBe(200);
        expect(db.user[0].image).toBeNull();
    });

    it.each([
        ["a remote URL", "https://example.com/me.png"],
        ["an SVG", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
        ["an oversized image", `data:image/webp;base64,${"A".repeat(200_000)}`],
    ])("rejects %s", async (_label, image) => {
        const { request, signUp } = setup();
        const cookie = await signUp();
        expect(await request("POST", "/update-user", { image }, cookie)).toMatchObject({
            code: "INVALID_AVATAR",
        });
    });
});
