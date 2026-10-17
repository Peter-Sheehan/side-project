// Creates a shared development account, so a fresh database has someone to sign
// in as. Runs in the auth-migrate container after migrations, and only when
// SEED_DEV_ACCOUNT=true.
//
// The email and password come from SEED_DEV_EMAIL / SEED_DEV_PASSWORD. Locally
// they default to dev@gmail.com / secret123. That password is in this repo, so
// it's refused anywhere but localhost: on a VM or server, set a strong
// SEED_DEV_PASSWORD in its .env and share it through a password manager.
//
// The account is created with Better Auth's own adapter and password hasher, so
// sign-in accepts it, and it's marked verified so no confirmation email is sent.
// Running it again only marks an existing dev account verified (accounts made
// before email verification was required aren't); changing SEED_DEV_PASSWORD
// later doesn't update it.
import { auth } from "./auth.js";

const DEFAULT_PASSWORD = "secret123";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocal(): boolean {
    try {
        return LOCAL_HOSTS.has(new URL(process.env.BETTER_AUTH_URL ?? "").hostname);
    } catch {
        return false;
    }
}

async function main() {
    if (process.env.SEED_DEV_ACCOUNT !== "true") {
        console.log("Seed: SEED_DEV_ACCOUNT isn't true, skipping the dev account.");
        return;
    }

    const account = {
        name: process.env.SEED_DEV_NAME || "dev-account",
        email: process.env.SEED_DEV_EMAIL || "dev@gmail.com",
        password: process.env.SEED_DEV_PASSWORD || DEFAULT_PASSWORD,
    };

    if (account.password === DEFAULT_PASSWORD && !isLocal()) {
        console.warn(
            `Seed: not creating ${account.email}: the default password is public and ` +
                `${process.env.BETTER_AUTH_URL} isn't localhost. Set SEED_DEV_PASSWORD in .env.`,
        );
        return;
    }

    const ctx = await auth.$context;
    const existing = await ctx.internalAdapter.findUserByEmail(account.email);
    if (existing) {
        if (!existing.user.emailVerified) {
            await ctx.internalAdapter.updateUser(existing.user.id, { emailVerified: true });
            console.log(`Seed: ${account.email} already exists; marked it verified.`);
        } else {
            console.log(`Seed: ${account.email} already exists.`);
        }
        return;
    }

    const user = await ctx.internalAdapter.createUser({
        name: account.name,
        email: account.email.toLowerCase(),
        emailVerified: true,
    }, { method: "email-password" });
    await ctx.internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: await ctx.password.hash(account.password),
    });
    console.log(`Seed: created ${account.email}.`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        // Don't block startup over the dev account (e.g. a password that's too
        // short): log it and let the auth service start.
        console.error("Seed: couldn't create the dev account:", err);
        process.exit(0);
    });
