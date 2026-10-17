import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

export const isWeakPassword = (password: string) =>
    !(/[A-Za-z]/.test(password) && /\d/.test(password));

const passwordField: Record<string, string> = {
    "/sign-up/email": "password",
    "/reset-password": "newPassword",
    "/change-password": "newPassword",
};

const MAX_AVATAR_LENGTH = 200_000;
const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

const isValidAvatar = (image: unknown) =>
    image === undefined ||
    image === null ||
    (typeof image === "string" && image.length <= MAX_AVATAR_LENGTH && AVATAR_PATTERN.test(image));

export const accountRules = () =>
    ({
        id: "account-rules",
        hooks: {
            before: [
                {
                    matcher: (ctx) => ctx.path !== undefined && ctx.path in passwordField,
                    handler: createAuthMiddleware(async (ctx) => {
                        const password: unknown = ctx.body?.[passwordField[ctx.path]];
                        if (typeof password === "string" && isWeakPassword(password)) {
                            throw new APIError("BAD_REQUEST", {
                                code: "PASSWORD_TOO_WEAK",
                                message: "Password must contain at least one letter and one number.",
                            });
                        }
                    }),
                },
                {
                    matcher: (ctx) => ctx.path === "/update-user",
                    handler: createAuthMiddleware(async (ctx) => {
                        if (!isValidAvatar(ctx.body?.image)) {
                            throw new APIError("BAD_REQUEST", {
                                code: "INVALID_AVATAR",
                                message: "Avatar must be a PNG, JPEG or WebP image under 150 KB.",
                            });
                        }
                    }),
                },
            ],
        },
    }) satisfies BetterAuthPlugin;
