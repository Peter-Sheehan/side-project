# Name to be Decided

A repository analysis app. Users sign in (email and password, GitHub, GitLab or Bitbucket), connect a code host, and the backend pulls in repositories and analyses their history.

**Status:** sign-in works, and the backend can link a GitHub account for repo access. Repo listing, analysis jobs and most of the frontend are not built yet. See [Status](#status).

## How it fits together

Everything runs in Docker Compose. The browser only ever talks to one address, <http://localhost:3000>. Caddy (in the `frontend` container) serves the app and forwards API calls:

```
browser ──► localhost:3000 (Caddy)
              ├─ /api/auth/*  ──► auth      (sign-in, sessions)
              ├─ /api/*       ──► backend   (everything else)
              └─ anything else ──► the React app
```

Because it's all one origin, there's no CORS, and the session cookie is first-party.

| Service | What it does | Direct port (this machine only) |
|---|---|---|
| `frontend` | React app built with Vite, served by Caddy, which also routes `/api` | **3000** (the only public port) |
| `auth` | [Better Auth](https://www.better-auth.com/docs) on Node. Owns users, sign-in and sessions | 3001 |
| `backend` | FastAPI (Python 3.12). Repo access and analysis. Checks sessions with `auth` | 8000 |
| `postgres` | PostgreSQL 18, shared by `auth` and `backend` (each manages only its own tables) | 5432 |
| `redis` | Cache | 6379 |
| `auth-migrate`, `backend-migrate` | Apply database migrations on start, then exit | – |

The direct ports are bound to `127.0.0.1` for debugging, so other machines can't reach them.

Signing in sets a `better-auth.session_token` cookie. When the backend gets a request with that cookie, it asks `auth` who the user is and caches the answer for 60 seconds.

## Prerequisites

- **Git**
- **Docker** with Compose v2 (`docker compose`, not the older `docker-compose`): Docker Desktop on Windows and macOS, or Docker Engine plus the Compose plugin on Linux
- **A bash shell** for the scripts in `scripts/`. On Windows use **Git Bash** (installed with Git for Windows), not PowerShell
- **A GitHub account**, and the client ID and secret of the org's shared GitHub App (ask an org admin)

You don't need Python, Node or uv installed. They run inside the containers.

## Getting started

Run everything from the project root, in Git Bash on Windows.

### 1. Clone

```sh
git clone git@github.com:failed-to-fetch/side-project.git
cd side-project
```

### 2. Get the org GitHub App credentials

Everyone uses one GitHub App owned by the org; don't create your own. Ask an org admin for its **Client ID** (starts with `Iv`) and a **client secret**. The App can hold several secrets, so admins can generate one per developer and revoke it without affecting anyone else. Never commit or paste secrets in chat.

The auth service won't start without these. Users link their own GitHub account later by authorizing the App (see [GitHub App for repo access](#github-app-for-repo-access)).

### 3. Create your `.env`

```sh
scripts/setup.sh
```

This creates `.env` from `.env.example` and generates the secrets (`TOKEN_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`). Then it lists what you still need to fill in.

Open `.env` and set the values from step 2. Both pairs take the same ID and secret:

```dotenv
GITHUB_LOGIN_CLIENT_ID=Iv23liXXXXXXXXXXXXXX
GITHUB_LOGIN_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_CLIENT_ID=Iv23liXXXXXXXXXXXXXX
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

No quotes, no spaces around `=`. `.env` is git-ignored; never commit it. Back up `TOKEN_ENCRYPTION_KEY`: if it's lost, stored tokens can't be decrypted and users have to re-link GitHub.

### 4. Start everything

```sh
scripts/setup.sh --up
```

The first run builds all the images, which takes a few minutes. Migrations are applied automatically before the backend and auth service start.

### 5. Check it works

```sh
docker compose ps -a
```

`auth-migrate` and `backend-migrate` should show `Exited (0)`. Everything else should be `Up`, and `backend`, `postgres` and `redis` should be `(healthy)`.

Then open <http://localhost:3000> and sign in. The backend API docs are at <http://localhost:3000/api/docs>.

### 6. Run the checks

```sh
scripts/check.sh
```

This runs what CI runs: lint, a format check, a migration check and the backend tests. All should pass.

### Upgrading from an older checkout

If you set the project up before October 2026 and see `table "test_messages" does not exist`, see [Troubleshooting](#troubleshooting). In short:

```sh
git pull
scripts/setup.sh                 # adds any new .env values
docker compose up -d --build     # rebuilds images and re-runs migrations
```

**Switch to the org GitHub App.** Personal OAuth Apps and GitHub Apps are no longer used. Replace `GITHUB_LOGIN_CLIENT_*` and `GITHUB_CLIENT_*` in `.env` with the org App's ID and secret (see [step 2](#2-get-the-org-github-app-credentials)), run `docker compose up -d`, then unlink and re-link GitHub: tokens from your old app don't work with the new one. You can delete your personal apps afterwards.

## Everyday development

```sh
docker compose up -d                     # start (also applies new migrations)
docker compose down                      # stop; your data is kept
docker compose logs -f backend           # follow one service's logs
docker compose ps -a                     # what's running, and migrate results
```

What picks up your changes:

| You changed | What to do |
|---|---|
| Backend code (`backend/app`) | Nothing. The backend auto-reloads |
| A backend migration | `docker compose up -d` (or see [Database migrations](#database-migrations)) |
| Backend dependencies | `docker compose build backend && docker compose up -d` |
| Auth service code (`services/auth`) | `docker compose up -d --build auth` |
| Frontend code | `docker compose up -d --build frontend`, or run Vite with hot reload (below) |
| `.env` or `docker-compose.yml` | `docker compose up -d` (running containers don't re-read them) |

**Frontend with hot reload.** The `frontend` container serves a production build. For hot reload, keep the stack running and start Vite alongside it. Vite forwards `/api` to the stack on port 3000, and the auth service trusts Vite's origin. This needs Node 24 and pnpm locally (`mise install` in `frontend/` if you use mise):

```sh
cd frontend && pnpm install && pnpm dev     # then open http://localhost:5173
```

If Vite runs on a different port, add that origin to `TRUSTED_ORIGINS` in `.env` and run `docker compose up -d`.

**Frontend only, against a deployed server.** No Docker needed: Vite can forward `/api` to a server that's already running, such as the test VM. Create `frontend/.env.local` (git-ignored; see `frontend/.env.example`):

```dotenv
VITE_API_PROXY=https://203-0-113-10.sslip.io
```

Then `pnpm dev` and open <http://localhost:5173>. The terminal shows `[api proxy] /api -> https://...` so you can see which server you're using. Things to know:

- **You're using that server's real data.** Accounts and anything you create are on the shared server, not your machine.
- The server must trust `http://localhost:5173`. It does by default. A server that overrides `TRUSTED_ORIGINS` must include it, or sign-in fails with 403 `Invalid origin`.
- Against an HTTPS server, the session cookie is secure-only. Chrome, Edge and Firefox accept it on `http://localhost`; Safari may not, so use one of those.
- Email sign-in works. Flows that leave the site and come back (GitHub sign-in, GitHub linking) return to the server's own address, not to `localhost:5173`.

### Scripts

| Script | What it does |
|---|---|
| `scripts/setup.sh [--up\|--fresh]` | Creates `.env` and generates its secrets. Never overwrites values you've set. `--up` also starts everything. `--fresh` deletes the local database, generates a new `POSTGRES_PASSWORD` and starts everything (asks you to type `reset` first) |
| `scripts/check.sh [--fix]` | Lint, format check, migration check, backend tests. `--fix` applies formatting first |
| `scripts/new-migration.sh "msg"` | Generates an Alembic migration from model changes |
| `scripts/reset-db.sh` | Deletes the local database and starts fresh. Asks you to type `reset` first |
| `scripts/deploy.sh [branch or commit]` | On a server: checks out a branch or commit (default: latest `Main`), rebuilds what changed, waits until healthy. Used by Jenkins |

## Backend

The layout and how to add a feature are in [`backend/README.md`](backend/README.md); the tests in [`backend/tests/README.md`](backend/tests/README.md). The tests run against your local database inside transactions that are rolled back, so they leave no data behind.

CI ([`.github/workflows/backend.yml`](.github/workflows/backend.yml)) runs the same checks as `scripts/check.sh` on every pull request that touches `backend/`, plus a migration downgrade and upgrade.

### Dependencies

[uv](https://docs.astral.sh/uv/) manages them: `backend/pyproject.toml` lists them, and `backend/uv.lock` pins exact versions. Commit both together. Run uv inside the container:

```sh
docker compose run --rm backend uv add <package>          # runtime dependency
docker compose run --rm backend uv add --dev <package>    # test or lint tool only
docker compose run --rm backend uv lock --upgrade         # upgrade within the constraints
docker compose build backend && docker compose up -d
```

The backend image has two targets. Compose uses `dev` (with pytest and ruff, code bind-mounted). The default `prod` target has runtime dependencies only and runs as a non-root user.

## Database migrations

The backend's schema is managed with Alembic, and Better Auth's tables by its own migrations (`auth-migrate`). Alembic ignores Better Auth's tables. Never use `Base.metadata.create_all()`, and never use `alembic stamp head` to hide a problem.

`docker compose up` applies pending migrations automatically. To run Alembic yourself:

```sh
docker compose run --rm backend alembic upgrade head    # apply
docker compose run --rm backend alembic current         # should end in "(head)"
docker compose run --rm backend alembic history
docker compose run --rm backend alembic downgrade -1    # roll back one; can destroy data
```

### Create a migration

1. Change or add the model in its feature folder (e.g. `backend/app/features/integrations/models.py`). A **new** model must also be imported in `backend/app/models.py`, or Alembic won't see it.
2. Generate the migration:
   ```sh
   scripts/new-migration.sh "describe the change"
   ```
3. **Read the new file** in `backend/alembic/versions/` before applying it. Check every `drop_table` and `drop_column`. Autogenerate also misses renames and data changes, and can misread expression indexes (such as one on `lower(email)`).
4. Apply it with `docker compose up -d`, and run `scripts/check.sh`.
5. Commit the migration together with the model change.

### Reset or change the database

`scripts/reset-db.sh` deletes all local data (users, sessions, linked accounts) and starts fresh. `scripts/setup.sh --fresh` does the same and also replaces `POSTGRES_PASSWORD` with a newly generated one. Use either only on a development machine, and never to work around a broken migration on data you care about.

Postgres only reads `POSTGRES_PASSWORD` when its volume is first created. To change the password and keep your data, set the new value in `.env`, then:

```sh
docker compose exec postgres psql -U app -d appdb -c "ALTER USER app PASSWORD 'the-new-password'"
docker compose up -d
```

## GitHub App for repo access

The org owns one GitHub App that every environment uses. A user clicks "Connect GitHub", authorizes the App with their own GitHub account, and the backend stores that user's token (encrypted) to call the GitHub API on their behalf. Without the App's credentials, everything else works and linking returns 503.

What a user's token can reach is limited three ways: the App's permissions, the user's own access, and the accounts where the App is **installed**. Authorizing isn't installing: to reach repos in their personal account, a user also installs the App there from its public page. Users can't choose scopes; they choose which repos the install covers.

### Linking your account

1. Put the org App's ID and secret in `.env` as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (see [step 2](#2-get-the-org-github-app-credentials)), then run `docker compose up -d`.
2. Sign in at <http://localhost:3000>, then open <http://localhost:3000/api/integrations/github/link> in the same browser. Approve the App on GitHub. You should land back on `/landing`, showing your GitHub username and repositories.

Start the link from the same origin as the backend. A local frontend proxied to a remote backend fails with `invalid_state`, because the callback returns to the remote address.

### App settings (org admins)

The App lives under the org: <https://github.com/organizations/failed-to-fetch/settings/apps>.

| Field | Value |
|---|---|
| Homepage URL | the production frontend URL |
| Redirect URIs | `<PUBLIC_URL>/api/integrations/github/callback` for every deployment, including `http://localhost:3000/...` (up to 10) |
| Allow wildcard matching | unticked |
| Expire user authorization tokens | ticked |
| Request user authorization (OAuth) during installation | unticked (installs would come back without our `state` and fail) |
| Enable Device Flow | unticked |
| Webhook, Active | unticked |
| Repository permissions | Contents: Read-only, Metadata: Read-only |
| Where can this GitHub App be installed | Any account |

The same App's ID and secret also fill `GITHUB_LOGIN_CLIENT_*`, which the auth service requires. The login page doesn't offer "Sign in with GitHub" yet; if it's turned on, add `<PUBLIC_URL>/api/auth/callback/github` to the redirect URIs and set **Account permissions, Email addresses** to Read-only.

To add a deployment, add its callback URL to the redirect URIs. To give a developer access, **Generate a new client secret** for them; revoke it when they leave.

If it fails, the redirect ends in `?error=<reason>`:

| Reason | Fix |
|---|---|
| `github_error` | Wrong client secret (or it was revoked), or `<PUBLIC_URL>/api/integrations/github/callback` isn't in the App's redirect URIs |
| `already_linked` | That GitHub account is linked to a different user |
| `invalid_state`, `expired_state` | Took over 10 minutes, or the cookie was lost. Start again in the same browser |
| `github_denied` | You cancelled on GitHub |

## API overview

All paths are on the public address (<http://localhost:3000> locally).

Sign-in, sign-out and sessions: the auth service at `/api/auth/*` ([Better Auth API](https://www.better-auth.com/docs)). The frontend uses it through `authClient` in `frontend/src/lib/auth-client.ts`.

Backend (interactive docs at `/api/docs`):

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | `{"status": "ok"}` |
| `GET /api/users/me` | session | current user: `{id, email, name}` |
| `GET /api/integrations/github/link` | session | start linking GitHub for repo access |
| `GET /api/integrations/github/callback` | none | GitHub redirects here |
| `DELETE /api/integrations/github` | session | unlink GitHub (204; 404 if not linked) |

From the frontend, call the backend with relative URLs such as `fetch("/api/users/me")`. The session cookie is sent automatically.

Errors use `{"detail": ...}`. 401 means no valid session; 503 means the auth service is unreachable. A sign-out can take up to 60 seconds to reach the backend because of the session cache.

## Running on a server or VM

The same compose file runs on a Linux VM for testing. Everything is reached through one port, and only that port is exposed.

1. On the VM, install Git and Docker (Engine plus the Compose plugin), clone the repo, and run `scripts/setup.sh`.
2. In the VM's `.env`, set the address you'll open in the browser:
   ```dotenv
   PUBLIC_URL=http://203.0.113.10:3000      # your VM's IP or hostname
   ```
   To serve on port 80 instead, also set `FRONTEND_PORT=80` and drop `:3000` from `PUBLIC_URL`.
3. **Register the callback URL for that address.** Ask an org admin to add `<PUBLIC_URL>/api/integrations/github/callback` to the org GitHub App's redirect URIs, and put the App's ID and secret in the VM's `.env`.
4. Allow the port in your cloud provider's firewall or security group (inbound TCP 3000, or 80).
5. Start it with `scripts/setup.sh --up`.

Check from **your own machine**:

```sh
curl http://203.0.113.10:3000/api/health          # {"status":"ok"}
curl -m 5 http://203.0.113.10:8000/api/health     # must time out or be refused
```

Postgres (5432), Redis (6379), the backend (8000) and auth (3001) are bound to `127.0.0.1` on the VM and must not be reachable from outside. This matters because Docker's published ports bypass `ufw` on Linux, so a host firewall alone doesn't protect them.

### HTTPS

Caddy can get a free Let's Encrypt certificate by itself, as long as it has a hostname that points at the VM. If you don't have a domain, [sslip.io](https://sslip.io) provides one: `203-0-113-10.sslip.io` resolves to `203.0.113.10`. Replace the dashes with your IP's numbers.

1. In the VM's `.env`:
   ```dotenv
   SITE_ADDRESS=203-0-113-10.sslip.io
   PUBLIC_URL=https://203-0-113-10.sslip.io
   COOKIE_SECURE=true
   FRONTEND_PORT=80
   HTTPS_PORT=443
   ```
2. In the cloud firewall, allow inbound **TCP 80 and 443**. Port 80 must be open to the whole internet while the certificate is issued and renewed, because Let's Encrypt connects to it to verify the domain. Caddy also uses it to redirect HTTP to HTTPS.
3. Update both GitHub callback URLs to `https://203-0-113-10.sslip.io/api/...`.
4. `docker compose up -d`, then follow `docker compose logs -f frontend` until you see `certificate obtained successfully` (usually within a minute).

Certificates are kept in the `caddy-data` volume and renewed automatically. If issuance fails, the logs say why. Usually port 80 isn't reachable from the internet, or the hostname doesn't resolve to this VM.

**Limits.** This is still the development setup: the backend runs with auto-reload from a bind mount and the dev image. That's fine for testing on a VM, but it isn't production-ready.

## Deploying with Jenkins

The `Jenkinsfile` deploys every push to `Main`. Jenkins connects to the server over SSH and runs `scripts/deploy.sh <commit>`, which:
- checks out that exact commit
- runs `docker compose up -d --build`, so only services whose image or config changed are rebuilt and restarted, and migrations run as part of it
- waits until everything is healthy, failing the Jenkins build if not

Unchanged images come from Docker's build cache, so a one-line backend change rebuilds just the backend.

### One-time setup

1. **On the server:** set up the project as in [Running on a server or VM](#running-on-a-server-or-vm). That checkout must be able to `git fetch` without a password: for a private repo, add a read-only [deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys) on GitHub. Don't edit tracked files there; `deploy.sh` refuses to deploy over hand edits.
2. **An SSH key for Jenkins:** run `ssh-keygen -t ed25519 -f jenkins-deploy -N ""` anywhere. Append `jenkins-deploy.pub` to `~/.ssh/authorized_keys` on the server, for a user in the `docker` group.
3. **In Jenkins:**
   - Install the **Pipeline**, **Git** and **GitHub Branch Source** plugins (plus **Credentials Binding**, which is part of the standard install).
   - Add two credentials:
     - *SSH Username with private key*, ID `side-project-deploy-ssh`, with the server's username and the contents of `jenkins-deploy`.
     - *Username with password*, ID `github-pat`, with your GitHub username and a fine-grained token that has read-only Contents and Metadata on this repo.
   - Under Manage Jenkins → System, set **Jenkins URL** to the address GitHub will use. Under Global properties, set environment variables `DEPLOY_HOST` (e.g. `ubuntu@203.0.113.10`) and, if the checkout isn't `~/side-project`, `DEPLOY_DIR` (relative to that user's home, or absolute). Don't leave `DEPLOY_HOST` empty: Jenkins would then try to deploy on its own machine.
   - Create a **Multibranch Pipeline** job with a **GitHub** branch source for this repo, credentials `github-pat` (or none, since the repo is public), discovering **all branches**. Every branch gets the *Build images* check that pull requests require. Only `Main`, or a build given `DEPLOY_REF`, deploys.
4. **Trigger on push:** in the GitHub repo, Settings → Webhooks → Add webhook, with payload URL `https://<your-jenkins>/github-webhook/` (keep the trailing slash), content type `application/json`, and just the push event. If GitHub can't reach your Jenkins, set the job's "Scan Multibranch Pipeline Triggers" to run every 5 minutes instead.
5. **Recommended: require both checks before merging into `Main`**, so broken code can't reach the deploy. See [Protecting Main](#protecting-main).

### Protecting Main

Every pull request gets two checks:

| Check | From | Proves |
|---|---|---|
| `Backend tests` | GitHub Actions (`.github/workflows/backend.yml`) | backend lint, migrations, tests |
| `continuous-integration/jenkins/pr-head` | Jenkins (*Build images* stage, on the pull request build) | all three production images build, including the frontend's TypeScript compile |

To require them: GitHub repo → **Settings → Branches → Add classic branch protection rule**:
- **Branch name pattern:** `Main`
- ✓ **Require a pull request before merging**
- ✓ **Require status checks to pass before merging**, then search for and add **`Backend tests`** and **`continuous-integration/jenkins/pr-head`**. A check only appears in the search after it has run at least once in the past week, so open a pull request first. Don't pick `continuous-integration/jenkins/branch`: that's the status for branch builds, and once a branch has a pull request Jenkins builds it as the pull request instead, so a required `…/branch` check would wait forever.
- ✓ **Require branches to be up to date before merging** (optional: re-runs the checks against the latest `Main`)
- ✓ **Do not allow bypassing the above settings**, so it applies to admins too
- **Create**

Both workflows must run for every branch, or a pull request waits forever for a missing check. That's why `Backend tests` runs on every pull request, and the Jenkins job must not filter out feature branches.

**If Jenkins runs on the same machine as the app:**
- **Jenkins in a Docker container** (the usual case): inside the container, `localhost` is the container itself. Add this to the Jenkins service in its compose file and recreate it:
  ```yaml
  extra_hosts:
    - "host.docker.internal:host-gateway"
  ```
  Then set `DEPLOY_HOST=<user>@host.docker.internal`. The Jenkins image needs an SSH client. Check with `docker exec <jenkins-container> which ssh`, and if it's missing, add `openssh-client` in the Jenkins Dockerfile.
- **Jenkins installed directly on the VM:** set `DEPLOY_HOST=<user>@localhost`. Or leave `DEPLOY_HOST` empty to run `deploy.sh` without SSH, in which case the `jenkins` user must be in the `docker` group and own the checkout, and `DEPLOY_DIR` must be an absolute path.

**A plain Pipeline job also works** instead of a Multibranch one. Choose *Pipeline script from SCM*, Git, this repo, branch `*/Main`, script path `Jenkinsfile`, and under Triggers tick *GitHub hook trigger for GITScm polling*. The webhook from step 4 triggers it.

### Deploying a branch

Open the job → **Build with Parameters** and set `DEPLOY_REF` to a branch name (or commit). That branch replaces whatever is deployed until the next push to `Main` puts `Main` back. The first build after adding the Jenkinsfile registers the parameter; until then the button just says *Build Now*.

**Migrations don't switch back on their own.** If the branch adds a migration, the database moves ahead of `Main`, and the next `Main` deploy fails with `Can't locate revision`. Before switching back, while the branch is still deployed, downgrade on the server:

```sh
docker compose run --rm backend alembic downgrade <Main's head revision>
```

### Disk usage

Builds clean up after themselves:
- the *Build images* stage removes its image tags
- `deploy.sh` removes images replaced by a deploy
- both drop Docker build cache unused for 7 days

Jenkins keeps the last 30 builds per branch or pull request. In the job's configuration, set **Orphaned Item Strategy → Discard old items** (e.g. 7 days), so jobs for merged pull requests and deleted branches are removed too.

To check on the server: `docker system df` shows images, containers, volumes and build cache; `df -h /` shows free space. To reclaim space at once, `docker builder prune -f` empties the build cache, and the next build is slower.

### Rolling back

On the server, deploy any earlier commit:

```sh
git log --oneline -10 origin/Main     # find the commit
scripts/deploy.sh <commit>
```

The next push to `Main` deploys the latest code again. Migrations aren't rolled back automatically. If the bad commit added one, see [Database migrations](#database-migrations).

## Troubleshooting

Start with `docker compose ps -a` and `docker compose logs <service> --tail 60`.

| Symptom | Cause and fix |
|---|---|
| `table "test_messages" does not exist` while migrating | Old migrations (before October 2026) tried to drop a table that a fresh database never had. Pull the latest code, which fixes them, then `docker compose up -d --build`. If your database is still stuck, `scripts/reset-db.sh` |
| `service "auth-migrate" didn't complete successfully`; `auth`, `backend` and `frontend` stay `Created` | A required `.env` value is empty. `docker compose logs auth-migrate` names it, usually `GITHUB_LOGIN_CLIENT_ID` or `GITHUB_LOGIN_CLIENT_SECRET`. Fill it in, then `docker compose up -d` |
| `backend-migrate` shows `Exited (1)` | A migration failed: `docker compose logs backend-migrate` |
| Backend logs `validation error for Settings` | A `.env` value is missing or malformed; the error names it. Run `scripts/setup.sh`, then `docker compose up -d` |
| `password authentication failed for user "app"` | `POSTGRES_PASSWORD` in `.env` doesn't match the one the database was created with. See [Reset or change the database](#reset-or-change-the-database) |
| `{"detail":"Authentication service unavailable."}` | `auth` is down: `docker compose logs auth --tail 60` |
| `{"detail":"GitHub is not configured."}` | The optional repo-access GitHub App isn't set up. See [GitHub App for repo access](#github-app-for-repo-access) |
| `relation "..." does not exist` | Migrations didn't run: `docker compose up -d`, then check `backend-migrate` |
| `Bind for 0.0.0.0:3000 failed: port is already allocated` | Something else uses that port. Stop it, or set `FRONTEND_PORT` (and `PUBLIC_URL` to match) in `.env` |
| Sign-in fails with 403 `Invalid origin` | The page's origin isn't trusted: it must be `PUBLIC_URL` or listed in `TRUSTED_ORIGINS` |
| GitHub says `redirect_uri is not associated with this application` | The callback URL in your GitHub settings doesn't match `PUBLIC_URL` (see [Upgrading](#upgrading-from-an-older-checkout)) |
| `502 Bad Gateway` on `/api/...` | Caddy can't reach `auth` or `backend`: check `docker compose ps -a` and their logs |
| `ModuleNotFoundError` in the backend | The image is older than `uv.lock`: `docker compose build backend && docker compose up -d` |
| A script fails with `$'\r': command not found` | It was checked out with Windows line endings. Run `git rm --cached -r -q . && git reset --hard` (commit your work first) |
| A `.env` change has no effect | Running containers don't re-read it: `docker compose up -d` |

## Status

**Built**
- Sign-in with email and password, GitHub, GitLab and Bitbucket (auth service)
- Backend checks Better Auth sessions
- Linking GitHub for repo access, with tokens encrypted at rest
- Backend tests, lint and CI
- One origin for frontend, auth and backend (Caddy), with a Vite dev proxy

**Not built yet**
- Most of the frontend
- A production compose setup (no auto-reload or bind mounts)
- GitHub repo listing and installation tokens
- Repo cloning and analysis jobs
- Password reset, email verification, login rate limiting
