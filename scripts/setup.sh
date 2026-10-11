#!/usr/bin/env bash
# First-time setup: creates .env, generates its secrets, optionally starts everything.
# Safe to re-run: it never overwrites a value you've set.
#   scripts/setup.sh        set up .env only
#   scripts/setup.sh --up     also build and start the stack
#   scripts/setup.sh --fresh  delete the local database, generate a new POSTGRES_PASSWORD
#                             and start the stack (development only, asks first)
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=.env

start=false
fresh=false
for arg in "$@"; do
  case "$arg" in
    --up) start=true ;;
    --fresh) fresh=true; start=true ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null 2>&1 || {
  echo "Error: Docker is not installed (Docker Desktop on Windows/macOS, Docker Engine on Linux)." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "Error: Docker Compose v2 ('docker compose') is not available." >&2
  exit 1
}
# Needed to tell whether the database volume already exists (see POSTGRES_PASSWORD below).
docker info >/dev/null 2>&1 || {
  echo "Error: Docker is installed but not running. Start it and try again." >&2
  exit 1
}

# --- helpers -----------------------------------------------------------------

random_b64() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }
fernet_key() { random_b64 32 | tr '+/' '-_'; }  # URL-safe base64 of 32 random bytes
random_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# Last non-empty value of KEY in .env, or empty.
get_raw() {
  awk -v k="$1" '
    index($0, k "=") == 1 { v = substr($0, length(k) + 2); if (v != "") last = v }
    END { printf "%s", last }' "$ENV_FILE"
}

# Like get_raw, but placeholders from older examples count as empty.
get() {
  local value
  value=$(get_raw "$1")
  case "$value" in replace_with_*|your_*) value="" ;; esac
  printf '%s' "$value"
}

# Set KEY=VALUE in place (first occurrence; drops duplicates), or append it.
set_value() {
  local key=$1 value=$2 tmp
  tmp=$(mktemp)
  if grep -qE "^$key=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" '
      index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
      { print }' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"  # cat, not mv, keeps the file's permissions
  rm -f "$tmp"
}

generated=""
# fill KEY COMMAND...: set KEY to COMMAND's output, only if KEY is empty.
fill() {
  local key=$1
  shift
  if [[ -z $(get "$key") ]]; then
    set_value "$key" "$("$@")"
    generated="$generated $key"
  fi
}

project=$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
volume="${COMPOSE_PROJECT_NAME:-$project}_postgres-data"

# --- .env --------------------------------------------------------------------

if [[ ! -f $ENV_FILE ]]; then
  cp .env.example "$ENV_FILE"
  echo "Created .env from .env.example"
fi
chmod 600 "$ENV_FILE" 2>/dev/null || true

# Strip Windows line endings and make sure the last line ends with a newline.
tmp=$(mktemp)
tr -d '\r' < "$ENV_FILE" | awk '{ print }' > "$tmp"
cat "$tmp" > "$ENV_FILE"
rm -f "$tmp"

# Merge duplicate keys into one line holding the last non-empty value, so a key
# that's set somewhere is never mistaken for empty (and replaced).
for key in $(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | sort | uniq -d | tr -d '='); do
  set_value "$key" "$(get_raw "$key")"
  echo "Merged duplicate $key lines in .env"
done

if $fresh; then
  echo "--fresh permanently deletes the local database ($volume):"
  echo "all users, sessions and linked accounts. Redis is kept."
  read -r -p 'Type "reset" to continue: ' answer
  if [[ $answer != reset ]]; then
    echo "Cancelled."
    exit 1
  fi
  docker compose down  # containers must be gone before their volume can be removed
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    docker volume rm "$volume" >/dev/null
    echo "Deleted $volume"
  fi
  set_value POSTGRES_PASSWORD ""  # so a new one is generated below
fi

fill TOKEN_ENCRYPTION_KEY fernet_key
fill BETTER_AUTH_SECRET random_b64 32

# Postgres only reads POSTGRES_PASSWORD when its volume is first created, so a
# new password for an existing volume would lock everything out of the database.
# A volume created while POSTGRES_PASSWORD was unset (including every one from before
# it moved to .env) has compose's default "password", so pin that rather than leave a
# placeholder that compose would send as the real password.
if [[ -z $(get POSTGRES_PASSWORD) ]] && docker volume inspect "$volume" >/dev/null 2>&1; then
  set_value POSTGRES_PASSWORD password
  echo
  echo "Note: the database ($volume) already exists, so POSTGRES_PASSWORD was set to"
  echo "      \"password\", the default it was created with, instead of a generated one."
  echo "      To switch to a generated password: scripts/setup.sh --fresh (deletes local data),"
  echo "      or ALTER USER as described in README.md."
else
  fill POSTGRES_PASSWORD random_hex 24
fi

# --- report ------------------------------------------------------------------

echo
if [[ -n $generated ]]; then
  echo "Generated:$generated"
  case "$generated" in *TOKEN_ENCRYPTION_KEY*)
    echo "Back up TOKEN_ENCRYPTION_KEY somewhere safe: without it, stored tokens can't be decrypted." ;;
  esac
else
  echo "All generated secrets were already set."
fi

missing=""
for key in GITHUB_LOGIN_CLIENT_ID GITHUB_LOGIN_CLIENT_SECRET; do
  [[ -n $(get "$key") ]] || missing="$missing $key"
done
optional=""
for key in GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET; do
  [[ -n $(get "$key") ]] || optional="$optional $key"
done

if [[ -n $missing ]]; then
  echo
  echo "Required, fill in .env:$missing"
  echo "  (the org's GitHub App; ask an org admin, see the comments in .env)"
fi
if [[ -n $optional ]]; then
  echo "Optional, empty:$optional (repo linking stays disabled until set)"
fi

if $start; then
  if [[ -n $missing ]]; then
    echo
    echo "Not starting: the auth service won't run without the required values above." >&2
    exit 1
  fi
  echo
  docker compose up -d --build
  url=$(get PUBLIC_URL)
  url=${url:-http://localhost:3000}
  echo
  echo "App:      $url"
  echo "API docs: $url/api/docs"
fi
