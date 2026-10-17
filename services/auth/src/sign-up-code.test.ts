import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signUpCode } from "./sign-up-code.js";

const BASE_URL = "http://localhost:3000";

type Sent = { to: string; kind: "code" | "existing"; code?: string };

function setup() {
    const db: Record<string, Record<string, unknown>[]> = {
        user: [],
        session: [],
        account: [],
        verification: [],
    };
    const sent: Sent[] = [];

    const auth = betterAuth({
        baseURL: BASE_URL,
        basePath: "/api/auth",
        secret: "test-secret-that-is-at-least-32-characters-long",
        database: memoryAdapter(db),
        logger: { disabled: true },
        emailAndPassword: {
            enabled: true,
            autoSignIn: false,
            requireEmailVerification: true,
        },
        emailVerification: { sendOnSignUp: false, sendVerificationEmail: async () => {} },
        plugins: [
            signUpCode({
                sendCode: async (to, code) => void sent.push({ to, kind: "code", code }),
                sendExistingAccount: async (user) =>
                    void sent.push({ to: user.email, kind: "existing" }),
            }),
        ],
    });

    async function post(path: string, body: object) {
        const res = await auth.handler(
            new Request(`${BASE_URL}/api/auth${path}`, {
                method: "POST",
                headers: { "content-type": "application/json", origin: BASE_URL },
                body: JSON.stringify(body),
            }),
        );
        const json = await res.json().catch(() => null);
        return { status: res.status, code: json?.code as string | undefined };
    }

    const lastCode = () => sent.filter((m) => m.kind === "code").at(-1)?.code ?? "";
    const wrongCode = (code: string) => (code === "000000" ? "111111" : "000000");

    async function createAccount(email: string, password = "password1") {
        await post("/sign-up/send-code", { email });
        const code = lastCode();
        await post("/sign-up/email", { name: "Test", email, password, code });
    }

    return { db, sent, post, lastCode, wrongCode, createAccount };
}

describe("send-code", () => {
    it("rejects a malformed email", async () => {
        const { post, sent } = setup();
        expect(await post("/sign-up/send-code", { email: "nope" })).toMatchObject({
            code: "INVALID_EMAIL",
        });
        expect(sent).toHaveLength(0);
    });

    it("emails a 6-digit code to a new address", async () => {
        const { post, sent } = setup();
        expect((await post("/sign-up/send-code", { email: "new@example.com" })).status).toBe(200);
        expect(sent).toEqual([{ to: "new@example.com", kind: "code", code: expect.stringMatching(/^\d{6}$/) }]);
    });

    it("answers the same for an existing account but sends a notice, not a code", async () => {
        const { post, sent, createAccount } = setup();
        await createAccount("taken@example.com");
        sent.length = 0;

        expect((await post("/sign-up/send-code", { email: "Taken@Example.com" })).status).toBe(200);
        expect(sent).toEqual([{ to: "taken@example.com", kind: "existing" }]);
    });

    describe("resend cooldown", () => {
        beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
        afterEach(() => vi.useRealTimers());

        it("doesn't resend within a minute, but does after", async () => {
            const { post, sent } = setup();
            await post("/sign-up/send-code", { email: "new@example.com" });
            await post("/sign-up/send-code", { email: "new@example.com" });
            expect(sent).toHaveLength(1);

            vi.setSystemTime(Date.now() + 61_000);
            await post("/sign-up/send-code", { email: "new@example.com" });
            expect(sent).toHaveLength(2);
        });
    });
});

describe("verify-code", () => {
    it("accepts the right code without using it up", async () => {
        const { post, lastCode } = setup();
        await post("/sign-up/send-code", { email: "new@example.com" });
        const code = lastCode();

        expect((await post("/sign-up/verify-code", { email: "new@example.com", code })).status).toBe(200);
        expect((await post("/sign-up/verify-code", { email: "new@example.com", code })).status).toBe(200);
    });

    it("rejects a wrong code", async () => {
        const { post, lastCode, wrongCode } = setup();
        await post("/sign-up/send-code", { email: "new@example.com" });

        expect(
            await post("/sign-up/verify-code", { email: "new@example.com", code: wrongCode(lastCode()) }),
        ).toMatchObject({ code: "INVALID_CODE" });
    });

    it("locks the code after 5 wrong tries", async () => {
        const { post, lastCode, wrongCode } = setup();
        await post("/sign-up/send-code", { email: "new@example.com" });
        const code = lastCode();

        for (let i = 0; i < 5; i++) {
            await post("/sign-up/verify-code", { email: "new@example.com", code: wrongCode(code) });
        }
        expect(await post("/sign-up/verify-code", { email: "new@example.com", code })).toMatchObject({
            code: "TOO_MANY_ATTEMPTS",
        });
    });

    it("never accepts a code for an existing account", async () => {
        const { post, createAccount } = setup();
        await createAccount("taken@example.com");
        await post("/sign-up/send-code", { email: "taken@example.com" });

        expect(
            await post("/sign-up/verify-code", { email: "taken@example.com", code: "123456" }),
        ).toMatchObject({ code: "INVALID_CODE" });
    });
});

describe("sign-up", () => {
    it("is refused without a valid code", async () => {
        const { post, db } = setup();
        await post("/sign-up/send-code", { email: "new@example.com" });

        expect(
            await post("/sign-up/email", { name: "Test", email: "new@example.com", password: "password1" }),
        ).toMatchObject({ code: "INVALID_CODE" });
        expect(db.user).toHaveLength(0);
    });

    it("creates a verified account, uses up the code, and allows sign-in", async () => {
        const { post, db, createAccount } = setup();
        await createAccount("new@example.com");

        expect(db.user).toEqual([expect.objectContaining({ email: "new@example.com", emailVerified: true })]);
        expect(db.verification.filter((v) => String(v.identifier).startsWith("sign-up-code:"))).toHaveLength(0);
        expect(
            (await post("/sign-in/email", { email: "new@example.com", password: "password1" })).status,
        ).toBe(200);
    });
});
