import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import Header from "../components/header";
import { RepoViewer } from "../components/repo-viewer";
import { useAuth } from "../lib/auth-context";

// The backend redirects to /landing?error=<reason> when linking fails.
const linkErrors: Record<string, string> = {
    github_denied: "GitHub access wasn't granted.",
    github_error: "GitHub rejected the request. Try again.",
    already_linked: "That GitHub account is linked to another user.",
    invalid_state: "The link expired or was started in another browser. Try again.",
    expired_state: "The link expired or was started in another browser. Try again.",
};

type GitHubState =
    | { status: "loading" }
    | { status: "linked"; login: string | null; installUrl: string | null }
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
function RepoList({
    installUrl,
    onRevoked,
}: {
    installUrl: string | null;
    onRevoked: () => void;
}) {
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

            {/* GitHub's install page also lets users change the repos on an
                existing install ("Configure"). */}
            {state.status === "loaded" && installUrl && (
                <a
                    href={installUrl}
                    className={
                        state.repos.length === 0
                            ? "mt-3 block w-full rounded-lg bg-primary px-4 py-3 text-center text-primary-foreground"
                            : "mt-3 block w-full rounded-lg border px-4 py-2 text-center text-sm"
                    }
                >
                    {state.repos.length === 0
                        ? "Install the GitHub App"
                        : "Add or change repositories"}
                </a>
            )}
        </div>
    );
}

export default function SuccessPage() {
    const { session, signOut } = useAuth();
    const email = session?.user.email ?? "";
    const [searchParams, setSearchParams] = useSearchParams();
    const [github, setGithub] = useState<GitHubState>({ status: "loading" });
    const [linkError] = useState(() => {
        const reason = searchParams.get("error");
        return reason ? (linkErrors[reason] ?? "Linking GitHub failed.") : null;
    });

    // Drop ?linked= / ?error= so a refresh doesn't show the message again.
    useEffect(() => {
        if (searchParams.size > 0) setSearchParams({}, { replace: true });
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        // The backend checks with GitHub, so "linked" means GitHub still accepts it.
        fetch("/api/integrations/github")
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data: {
                    status: "linked" | "unlinked" | "revoked";
                    login: string | null;
                    install_url: string | null;
                } = await res.json();
                setGithub(
                    data.status === "linked"
                        ? { status: "linked", login: data.login, installUrl: data.install_url }
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
                            <RepoList
                                installUrl={github.installUrl}
                                onRevoked={handleRevoked}
                            />
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

                    <RepoViewer onRevoked={handleRevoked} />

                    <button
                        type="button"
                        onClick={signOut}
                        className="mt-8 w-full rounded-lg border px-4 py-3"
                    >
                        Sign out
                    </button>
                </section>
            </main>
        </>
    );
}
