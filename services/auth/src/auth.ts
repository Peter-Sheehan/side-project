import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { genericOAuth } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
    existingAccountEmail,
    sendEmail,
    signUpCodeEmail,
    verificationEmail,
    type Email,
} from "./mailer.js";
import { signUpCode } from "./sign-up-code.js";

const requiredEnv = (name: string): string => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
};

// The public address (PUBLIC_URL in compose). It must be a bare origin: if it has
// a path, Better Auth uses that path as its route prefix and every /api/auth/*
// request returns 404.
const publicOrigin = (() => {
    const raw = requiredEnv("BETTER_AUTH_URL");
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        url = new URL("invalid:");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(
            `BETTER_AUTH_URL (PUBLIC_URL) must start with http:// or https://, got "${raw}"`
        );
    }
    if (url.pathname !== "/" || url.search || url.hash) {
        throw new Error(
            `BETTER_AUTH_URL (PUBLIC_URL) must be just scheme://host[:port] with no path, ` +
                `e.g. http://203.0.113.10:3000. Got "${raw}".`
        );
    }
    return url.origin;
})();

// A failed send is logged, not thrown: sign-up must answer the same way whether
// or not the email was already registered, and an unverified user can get a
// new link by signing in.
async function sendSafely(email: Email): Promise<void> {
    try {
        await sendEmail(email);
    } catch (err) {
        console.error(`[mail] couldn't send "${email.subject}" to ${email.to}:`, err);
    }
}

const pool = new Pool({
    connectionString: requiredEnv("DATABASE_URL"),
});

const gitlabClientId = process.env.GITLAB_LOGIN_CLIENT_ID;
const gitlabClientSecret = process.env.GITLAB_LOGIN_CLIENT_SECRET;

const bitbucketClientId = process.env.BITBUCKET_LOGIN_CLIENT_ID;
const bitbucketClientSecret = process.env.BITBUCKET_LOGIN_CLIENT_SECRET;

const genericProviders = [];

if (gitlabClientId && gitlabClientSecret) {
    genericProviders.push({
        providerId: "gitlab",
        clientId: gitlabClientId,
        clientSecret: gitlabClientSecret,
        authorizationUrl: "https://gitlab.com/oauth/authorize",
        tokenUrl: "https://gitlab.com/oauth/token",
        userInfoUrl: "https://gitlab.com/api/v4/user",
        scopes: ["read_user"],
        getUserInfo: async (tokens: { accessToken?: string }) => {
            const accessToken = tokens.accessToken;

            if (!accessToken) {
                throw new Error("GitLab OAuth response did not include an access token");
            }

            const response = await fetch("https://gitlab.com/api/v4/user", {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            if (!response.ok) {
                throw new Error("Unable to retrieve GitLab profile");
            }

            const profile = await response.json();

            return {
                id: String(profile.id),
                name: profile.name ?? profile.username,
                email: profile.email ?? null,
                image: profile.avatar_url ?? null,
                emailVerified: false,
            };
        },
    });
}

if (bitbucketClientId && bitbucketClientSecret) {
    genericProviders.push({
        providerId: "bitbucket",
        clientId: bitbucketClientId,
        clientSecret: bitbucketClientSecret,
        authorizationUrl: "https://bitbucket.org/site/oauth2/authorize",
        tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
        userInfoUrl: "https://api.bitbucket.org/2.0/user",
        scopes: ["account:read", "email"],
        getUserInfo: async (tokens: { accessToken?: string }) => {
            const accessToken = tokens.accessToken;

            if (!accessToken) {
                throw new Error("Bitbucket OAuth response did not include an access token");
            }

            const headers = {
                Authorization: `Bearer ${accessToken}`,
            };

            const [profileResponse, emailResponse] = await Promise.all([
                fetch("https://api.bitbucket.org/2.0/user", { headers }),
                fetch("https://api.bitbucket.org/2.0/user/emails", { headers }),
            ]);

            if (!profileResponse.ok) {
                throw new Error("Unable to retrieve Bitbucket profile");
            }

            const profile = await profileResponse.json();

            const emailData = emailResponse.ok
                ? await emailResponse.json()
                : { values: [] };

            const primaryEmail = emailData.values?.find(
                (entry: { is_primary?: boolean; is_confirmed?: boolean }) =>
                    entry.is_primary && entry.is_confirmed
            );

            return {
                id: String(profile.uuid),
                name: profile.display_name,
                email: primaryEmail?.email ?? null,
                image: profile.links?.avatar?.href ?? null,
                emailVerified: Boolean(primaryEmail),
            };
        },
    });
}

export const auth = betterAuth({
    baseURL: publicOrigin,
    basePath: "/api/auth",
    secret: requiredEnv("BETTER_AUTH_SECRET"),

    database: pool,

    // baseURL's origin is trusted automatically. Extra origins (e.g. the Vite dev
    // server) come from TRUSTED_ORIGINS, comma-separated.
    trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),

    emailAndPassword: {
        enabled: true,
        autoSignIn: false,
        // Mirrored in frontend/src/lib/sign-up-validation.ts.
        minPasswordLength: 8,
        maxPasswordLength: 128,
        requireEmailVerification: true,
    },

    emailVerification: {
        sendOnSignUp: false,
        // An unverified user who signs in with the right password gets a new link.
        sendOnSignIn: true,
        // Opening the link signs the user in, then redirects to the callbackURL
        // the frontend passed (/login, which forwards signed-in users on).
        autoSignInAfterVerification: true,
        expiresIn: 60 * 60,
        sendVerificationEmail: async ({ user, url }) => {
            await sendSafely(verificationEmail(user.email, user.name, url));
        },
    },

    hooks: {
        before: createAuthMiddleware(async (ctx) => {
            if (ctx.path !== "/sign-up/email") return;
            const password: unknown = ctx.body?.password;
            if (
                typeof password === "string" &&
                !(/[A-Za-z]/.test(password) && /\d/.test(password))
            ) {
                throw new APIError("BAD_REQUEST", {
                    code: "PASSWORD_TOO_WEAK",
                    message: "Password must contain at least one letter and one number.",
                });
            }
        }),
    },

    // Sessions end after 30 minutes without activity. GET /api/auth/get-session
    // renews one (new expiry in the DB, new cookie) once it's over 5 minutes old;
    // the frontend calls it while the user is active. The backend's own lookups
    // pass disableRefresh, so API calls alone don't keep a session alive.
    session: {
        expiresIn: 60 * 30,
        updateAge: 60 * 5,
    },

    socialProviders: {
        github: {
            clientId: requiredEnv("GITHUB_LOGIN_CLIENT_ID"),
            clientSecret: requiredEnv("GITHUB_LOGIN_CLIENT_SECRET"),
        },
    },

    account: {
        accountLinking: {
            enabled: true,
            disableImplicitLinking: true,
        },
    },

    plugins: [
        signUpCode({
            sendCode: (email, code) => sendSafely(signUpCodeEmail(email, code)),
            sendExistingAccount: (user) =>
                sendSafely(existingAccountEmail(user.email, user.name, `${publicOrigin}/login`)),
        }),
        ...(genericProviders.length > 0
            ? [
                genericOAuth({
                    config: genericProviders,
                }),
            ]
            : []),
    ],
});