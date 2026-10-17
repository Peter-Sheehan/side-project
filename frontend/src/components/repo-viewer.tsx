import { useState, type FormEvent } from "react";

type RepoEntry = {
    name: string;
    type: "file" | "dir" | "symlink" | "submodule";
    html_url: string;
};

type RepoView = {
    full_name: string;
    description: string | null;
    html_url: string;
    private: boolean;
    default_branch: string;
    language: string | null;
    stars: number;
    forks: number;
    files: RepoEntry[];
};

type ViewState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; repo: RepoView }
    | { status: "error"; message: string };

/** Paste a GitHub repo URL (or owner/name) to see its details and top-level files. */
export function RepoViewer({ onRevoked }: { onRevoked: () => void }) {
    const [url, setUrl] = useState("");
    const [state, setState] = useState<ViewState>({ status: "idle" });

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        if (!url.trim()) return;
        setState({ status: "loading" });

        try {
            const res = await fetch(
                `/api/integrations/github/repos/view?${new URLSearchParams({ url })}`,
            );
            if (res.ok) {
                setState({ status: "loaded", repo: await res.json() });
                return;
            }
            // The link to GitHub was revoked; the page asks the user to re-link.
            if (res.status === 409) onRevoked();
            const body = await res.json().catch(() => null);
            setState({
                status: "error",
                message:
                    typeof body?.detail === "string"
                        ? body.detail
                        : "Couldn't load that repository.",
            });
        } catch {
            setState({ status: "error", message: "Couldn't reach the server." });
        }
    }

    return (
        <div className="mt-8 text-left">
            <h2 className="text-sm font-semibold">View a repository</h2>

            <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
                <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    aria-label="GitHub repository URL"
                    className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
                />
                <button
                    type="submit"
                    disabled={state.status === "loading" || !url.trim()}
                    className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                >
                    {state.status === "loading" ? "Loading…" : "View"}
                </button>
            </form>

            {state.status === "error" && (
                <p className="mt-2 text-sm text-red-600">{state.message}</p>
            )}

            {state.status === "loaded" && <RepoDetails repo={state.repo} />}
        </div>
    );
}

function RepoDetails({ repo }: { repo: RepoView }) {
    const facts = [
        repo.language,
        `★ ${repo.stars}`,
        `${repo.forks} forks`,
        `branch: ${repo.default_branch}`,
        repo.private ? "Private" : null,
    ].filter(Boolean);

    return (
        <div className="mt-3 rounded-lg border p-3 text-sm">
            <a
                href={repo.html_url}
                target="_blank"
                rel="noreferrer"
                className="break-all font-semibold hover:underline"
            >
                {repo.full_name}
            </a>
            {repo.description && (
                <p className="mt-1 text-muted-foreground">{repo.description}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{facts.join(" · ")}</p>

            {repo.files.length === 0 ? (
                <p className="mt-3 text-muted-foreground">This repository is empty.</p>
            ) : (
                <ul className="mt-3 max-h-64 divide-y overflow-y-auto rounded-lg border">
                    {repo.files.map((file) => (
                        <li key={file.name} className="px-3 py-1.5">
                            <a
                                href={file.html_url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 hover:underline"
                            >
                                <span aria-hidden className="w-4 text-center">
                                    {file.type === "dir" ? "📁" : "📄"}
                                </span>
                                <span className="truncate">{file.name}</span>
                            </a>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
