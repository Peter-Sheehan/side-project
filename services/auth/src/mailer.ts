import nodemailer from "nodemailer";

export interface Email {
    to: string;
    subject: string;
    text: string;
    html: string;
}

const smtpUrl = process.env.SMTP_URL;
const from = process.env.SMTP_FROM || "SideProject <no-reply@localhost>";

// Checked here so a typo fails with a readable message; nodemailer's own error
// prints the whole URL, password included.
function createTransport(url: string) {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        parsed = new URL("invalid:");
    }
    if (!["smtp:", "smtps:"].includes(parsed.protocol) || !parsed.hostname) {
        throw new Error(
            "SMTP_URL isn't a valid SMTP address. Expected smtp://host:port or " +
                "smtps://USER:PASSWORD@host:port (write the @ in an email username as %40).",
        );
    }
    return nodemailer.createTransport(url);
}

const transport = smtpUrl ? createTransport(smtpUrl) : null;

export async function sendEmail(email: Email): Promise<void> {
    if (!transport) {
        console.log(`[mail] SMTP_URL isn't set, not sending.\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}`);
        return;
    }
    await transport.sendMail({ from, ...email });
}

const escapeHtml = (value: string) =>
    value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(paragraphs: string[], link?: { url: string; label: string }): string {
    const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
    const button = link
        ? `<p><a href="${escapeHtml(link.url)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(link.label)}</a></p>` +
          `<p style="font-size:12px;color:#666">Or paste this link into your browser:<br>${escapeHtml(link.url)}</p>`
        : "";
    return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;max-width:480px">${body}${button}</div>`;
}

export function verificationEmail(to: string, name: string, url: string): Email {
    const lines = [
        `Hi ${name},`,
        "Confirm your email address to keep signing in to your SideProject account. The link expires in 1 hour.",
        "If you didn't sign up, you can ignore this email.",
    ];
    return {
        to,
        subject: "Confirm your email",
        text: [...lines, url].join("\n\n"),
        html: layout(lines, { url, label: "Confirm email" }),
    };
}

// No name in this one: it isn't known to belong to the address yet, and putting
// user-typed text in an email to someone else invites abuse.
export function signUpCodeEmail(to: string, code: string): Email {
    const lines = [
        `Your SideProject sign-up code is ${code}.`,
        "Enter it on the sign-up page to confirm your email. It expires in 10 minutes.",
        "If you didn't try to sign up, you can ignore this email.",
    ];
    return {
        to,
        subject: `${code} is your sign-up code`,
        text: lines.join("\n\n"),
        html: layout(lines),
    };
}

// Sent in place of a sign-up code, so the sign-up page never reveals which
// emails have accounts.
export function existingAccountEmail(to: string, name: string, signInUrl: string): Email {
    const lines = [
        `Hi ${name},`,
        "Someone (hopefully you) tried to create a SideProject account with this email, but you already have one.",
        "Sign in instead. If you signed up with GitHub, use that. If it wasn't you, you can ignore this email: nothing has changed on your account.",
    ];
    return {
        to,
        subject: "You already have an account",
        text: [...lines, signInUrl].join("\n\n"),
        html: layout(lines, { url: signInUrl, label: "Sign in" }),
    };
}
