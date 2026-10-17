# Backend tests

Tests for the FastAPI backend. They run inside Docker against the real Postgres and Redis services from `docker-compose.yml`.

## Prerequisites

- Docker with Compose v2 (`docker compose`, not the older `docker-compose`). Docker Desktop on Windows/macOS, or Docker Engine plus the Compose plugin on Linux
- Commands are run from the project root in PowerShell or sh/zsh
- The backend image has been built. Compose builds the `dev` target, which includes the `dev` dependency group (`pytest`, `ruff`) from `backend/pyproject.toml`:

```powershell
docker compose build backend
```

Rebuild again whenever `pyproject.toml` or `uv.lock` changes. Code and test changes do not need a rebuild, because `./backend` is bind-mounted into the container at `/app`.

## Run the tests

```powershell
docker compose run --rm backend python -m pytest -q
```

Use `python -m pytest` rather than bare `pytest`. It puts `/app` on the import path so `from app.main import app` works. Compose starts Postgres and Redis automatically (`depends_on`).

Expected result: all tests pass (68 at the time of writing: 37 unit, 31 integration).

## Useful variations

```powershell
# Verbose, one line per test
docker compose run --rm backend python -m pytest -v

# Only the unit tests (fast; no database or Redis needed)
docker compose run --rm backend python -m pytest tests/unit -q

# Only the integration tests
docker compose run --rm backend python -m pytest tests/integration -q

# One file
docker compose run --rm backend python -m pytest tests/integration/test_auth_api.py -v

# One test, or tests matching a name
docker compose run --rm backend python -m pytest -k unlink -v

# Stop at the first failure and show print output
docker compose run --rm backend python -m pytest -x -s
```

## What is covered

Tests are split by kind:

- **`unit/`** tests one piece of code on its own: no database, Redis, network or app. External HTTP is replaced by a fake transport or a patched `httpx.get`.
- **`integration/`** drives the FastAPI app through `TestClient` against real Postgres and Redis. Only services outside the backend (GitHub, Better Auth) are faked.

| File | Covers |
|---|---|
| `unit/test_github_client.py` | `GitHubClient` against a fake HTTP transport: request contents, token refresh, repo listing and viewing, how 401, 403 rate limits, 404 and error-in-a-200 replies are read |
| `unit/test_auth_session.py` | How the Better Auth `get-session` request is made and its response parsed |
| `unit/test_repo_ref.py` | Parsing pasted GitHub repo URLs and `owner/name` |
| `unit/test_config.py` | `PUBLIC_URL` validation and normalising |
| `integration/test_auth_api.py` | Checking Better Auth sessions on API calls: 401 without or with an unknown cookie, Redis caching, 503 when the auth service is down |
| `integration/test_github_link.py` | The GitHub endpoints with a fake `GitHubClient`: linking (state, PKCE, encrypted tokens, relinking, unlinking), link status and revocation, token refresh, repo listing and viewing |
| `integration/test_updated_at.py` | `updated_at` changes when a row is updated |
| `integration/test_services.py` | Postgres and Redis are reachable |
| `conftest.py` | Shared fixtures for both folders (see below) |

## How test isolation works

- **Postgres:** the `db` fixture opens a connection, starts a transaction, and rolls it back after each test. Commits inside the app become savepoints, so tests leave no rows behind and never see each other's data.
- **Redis:** the `redis_client` fixture uses database 15 and flushes it before and after each test. Your dev data in database 0 is never touched. This assumes `REDIS_URL` has no `/db` suffix, which matches the compose file.
- **Better Auth:** tests never call the auth service. The `sign_in` fixture fakes it (see below).
- **Exception:** `integration/test_updated_at.py` commits for real in its own session (Postgres `now()` is fixed for the length of a transaction, so a rolled-back test can't observe it changing). It uses random ids and deletes the row in a `finally` block.

The tests use the same database as development, so don't point them at data you care about without checking the fixtures first.

## Platform notes

- **Windows, macOS, Linux:** the commands are identical. Only the shell differs (PowerShell, zsh, bash).
- **Linux:** files created inside the container (such as `.pytest_cache/` and any Alembic migrations you generate) are owned by root on the host, because the container runs as root against the bind mount. If that gets in the way, `sudo chown -R "$USER" backend` fixes ownership. macOS and Windows with Docker Desktop don't have this issue.
- **Apple Silicon (M-series Macs):** the `python`, Postgres and Redis images are multi-arch, so no changes are needed.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ModuleNotFoundError` for a package | Image is out of date: `docker compose build backend` |
| `ModuleNotFoundError: app` | Run with `python -m pytest` from the project root, not bare `pytest` |
| `No module named 'psycopg2'` | Use `postgresql+psycopg://...` as `DATABASE_URL` in `docker-compose.yml` |
| `no tests ran` | Test files must live in `backend/tests/unit/` or `backend/tests/integration/` and be named `test_*.py` |
| `import file mismatch` | Two test files share a name. Give each a unique name across both folders (there are no `__init__.py` files) |
| `validation error for Settings` | Run through `docker compose run`, which supplies the environment variables |
| `relation "provider_connections" does not exist` | Apply migrations: `docker compose run --rm backend alembic upgrade head` |

The `httpx` deprecation warning from Starlette's `TestClient` is harmless.

## Adding a test

- Put it in `unit/` if it needs nothing but the code under test, otherwise in `integration/`.
- Use the `client` fixture for API tests. It already isolates Postgres and Redis.
- For endpoints that need a signed-in user, call `sign_in()` (or `sign_in("ba_bob", "bob@example.com")` for a second user). It sets a fake Better Auth session cookie and answers the backend's session lookup for it.
- Use `override_settings(NAME="value")` to change a setting for one test.
- Replace an external service with `app.dependency_overrides[get_x] = lambda: fake` (see `fake_github` in `integration/test_github_link.py`). The `client` fixture clears overrides after each test.
- Avoid naming a file `*_test.py` unless it is meant to be collected. Pytest picks up both `test_*.py` and `*_test.py`.