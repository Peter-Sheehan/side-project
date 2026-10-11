import { useCallback, useEffect, useState } from "react";
import Header from "../components/header";

type SuccessPageProps = {
    email: string;
    onSignOut: () => void;
};

// The backend redirects to /settings?error=<reason> when linking fails.
const linkErrors: Record<string, string> = {
    github_denied: "GitHub access wasn't granted.",
    github_error: "GitHub rejected the request. Try again.",
    already_linked: "That GitHub account is linked to another user.",
    invalid_state: "The link expired or was started in another browser. Try again.",
    expired_state: "The link expired or was started in another browser. Try again.",
};

type GitHubState =
    | { status: "loading" }
    | { status: "linked"; login: string | null }
    | { status: "unlinked" }
    | { status: "revoked" }
    | { status: "failed" };

type Repo = {
    full_name: string;
    private: boolean;
    html_url: string;
};

type RepoState =
    | { status: "loading" }
    | { status: "loaded"; repos: Repo[] }
    | { status: "failed" };

// Repos the linked account can reach through the GitHub App's installations.
function RepoList({ onRevoked }: { onRevoked: () => void }) {
    const [state, setState] = useState<RepoState>({ status: "loading" });

    useEffect(() => {
        fetch("/api/integrations/github/repos")
            .then(async (res) => {
                // GitHub stopped accepting the link and the backend removed it.
                if (res.status === 409) return onRevoked();
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const repos: Repo[] = await res.json();
                setState({ status: "loaded", repos });
            })
            .catch(() => setState({ status: "failed" }));
    }, [onRevoked]);

    return (
        <div className="mt-6 text-left">
            <h2 className="text-sm font-semibold">Repositories you can access</h2>

            {state.status === "loading" && (
                <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            )}

            {state.status === "failed" && (
                <p className="mt-2 text-sm text-red-600">
                    Couldn't load repositories. Try linking GitHub again.
                </p>
            )}

            {state.status === "loaded" && state.repos.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                    None yet. Install the GitHub App on your account or organization
                    and choose which repositories it can access.
                </p>
            )}

            {state.status === "loaded" && state.repos.length > 0 && (
                <ul className="mt-2 max-h-64 divide-y overflow-y-auto rounded-lg border text-sm">
                    {state.repos.map((repo) => (
                        <li
                            key={repo.full_name}
                            className="flex items-center justify-between gap-2 px-3 py-2"
                        >
                            <a
                                href={repo.html_url}
                                target="_blank"
                                rel="noreferrer"
                                className="truncate hover:underline"
                            >
                                {repo.full_name}
                            </a>
                            {repo.private && (
                                <span className="shrink-0 rounded-full border px-2 text-xs text-muted-foreground">
                                    Private
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default function SuccessPage({ email, onSignOut }: SuccessPageProps) {
    const [github, setGithub] = useState<GitHubState>({ status: "loading" });
    const [linkError] = useState(() => {
        const reason = new URLSearchParams(window.location.search).get("error");
        return reason ? (linkErrors[reason] ?? "Linking GitHub failed.") : null;
    });

    useEffect(() => {
        // Drop ?linked= / ?error= so a refresh doesn't show the message again.
        if (window.location.search) {
            window.history.replaceState(null, "", "/");
        }

        // The backend checks with GitHub, so "linked" means GitHub still accepts it.
        fetch("/api/integrations/github")
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data: {
                    status: "linked" | "unlinked" | "revoked";
                    login: string | null;
                } = await res.json();
                setGithub(
                    data.status === "linked"
                        ? { status: "linked", login: data.login }
                        : { status: data.status },
                );
            })
            .catch(() => setGithub({ status: "failed" }));
    }, []);

    const handleRevoked = useCallback(() => setGithub({ status: "revoked" }), []);

    return (
        <>
            <Header />
            <main className="flex min-h-svh items-center justify-center bg-background px-4">
                <section className="w-full max-w-md rounded-2xl border p-8 text-center shadow-sm">
                    <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-3xl text-green-700">
                        ✓
                    </div>

                    <h1 className="text-2xl font-semibold">
                        You have successfully signed in!
                    </h1>

                    <p className="mt-3 text-sm text-muted-foreground">
                        Welcome back. You are signed in with:
                    </p>

                    <p className="mt-2 break-all font-medium">{email}</p>

                    {github.status === "linked" ? (
                        <>
                            <p className="mt-8 rounded-lg bg-green-100 px-4 py-3 text-sm text-green-700">
                                Successfully linked to GitHub
                                {github.login && (
                                    <>
                                        {" as "}
                                        <span className="font-semibold">@{github.login}</span>
                                    </>
                                )}
                            </p>
                            <RepoList onRevoked={handleRevoked} />
                        </>
                    ) : (
                        <>
                            {linkError && (
                                <p className="mt-8 text-sm text-red-600">{linkError}</p>
                            )}
                            {github.status === "revoked" && (
                                <p className="mt-8 text-sm text-red-600">
                                    Your GitHub access was revoked or has expired. Link
                                    GitHub again to keep using your repositories.
                                </p>
                            )}
                            {github.status === "failed" && (
                                <p className="mt-8 text-sm text-red-600">
                                    Couldn't check your GitHub link.
                                </p>
                            )}
                            <a
                                href="/api/integrations/github/link"
                                aria-disabled={github.status === "loading"}
                                className="mt-8 block w-full rounded-lg bg-primary px-4 py-3 text-primary-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
                            >
                                Link GitHub
                            </a>
                        </>
                    )}

                    <button
                        type="button"
                        onClick={onSignOut}
                        className="mt-3 w-full rounded-lg border px-4 py-3"
                    >
                        Sign out
                    </button>
                </section>
            </main>
        </>
    );
}
