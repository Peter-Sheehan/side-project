"""HTTP calls to GitHub, and nothing else. No database, Redis or FastAPI here."""

import base64
import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings

AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
API_URL = "https://api.github.com"
PAGE_SIZE = 100  # GitHub's maximum


class GitHubError(Exception):
    """GitHub was unreachable, returned an error, or rejected the request."""


class GitHubAuthError(GitHubError):
    """GitHub no longer accepts the user's tokens: they revoked the App, or the
    refresh token expired. Only re-linking fixes it."""


@dataclass
class TokenSet:
    access_token: str
    refresh_token: str | None
    expires_at: datetime | None


@dataclass
class GitHubProfile:
    id: str  # numeric id as a string; stable, unlike the login
    login: str | None


@dataclass
class GitHubRepo:
    full_name: str  # "owner/name"
    private: bool
    html_url: str


def make_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


class GitHubClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        transport: httpx.BaseTransport | None = None,  # for tests
    ):
        self.client_id = client_id
        self._client_secret = client_secret
        self.redirect_uri = redirect_uri
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self._client_secret)

    def _http(self) -> httpx.Client:
        return httpx.Client(transport=self._transport, timeout=10)

    def authorize_url(self, state: str, code_challenge: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        return f"{AUTHORIZE_URL}?{urlencode(params)}"

    def exchange_code(self, code: str, code_verifier: str) -> TokenSet:
        return self._token_request(
            {
                "code": code,
                "redirect_uri": self.redirect_uri,
                "code_verifier": code_verifier,
            }
        )

    def refresh(self, refresh_token: str) -> TokenSet:
        """Swap a refresh token for new tokens. GitHub rotates the refresh token
        too, so the old one stops working: store the returned pair."""
        return self._token_request(
            {"grant_type": "refresh_token", "refresh_token": refresh_token}
        )

    def _token_request(self, params: dict[str, str]) -> TokenSet:
        try:
            with self._http() as http:
                r = http.post(
                    TOKEN_URL,
                    headers={"Accept": "application/json"},
                    data={
                        "client_id": self.client_id,
                        "client_secret": self._client_secret,
                        **params,
                    },
                )
                r.raise_for_status()
                data = r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise GitHubError("token request failed") from e
        # GitHub reports failures as HTTP 200 with an "error" field.
        if data.get("error") == "bad_refresh_token":
            # Expired (after 6 months), already used, or the user revoked the App.
            raise GitHubAuthError(data.get("error_description", "bad refresh token"))
        if "error" in data or "access_token" not in data:
            raise GitHubError(data.get("error_description", "token request failed"))
        expires_at = None
        if data.get("expires_in"):
            expires_at = datetime.now(UTC) + timedelta(seconds=int(data["expires_in"]))
        return TokenSet(data["access_token"], data.get("refresh_token"), expires_at)

    def _get(self, http: httpx.Client, token: str, path: str, **params) -> dict:
        r = http.get(
            f"{API_URL}{path}",
            params=params,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        if r.status_code == 401:
            raise GitHubAuthError("GitHub rejected the token")
        r.raise_for_status()
        return r.json()

    def fetch_profile(self, token: str) -> GitHubProfile:
        try:
            with self._http() as http:
                data = self._get(http, token, "/user")
        except (httpx.HTTPError, ValueError) as e:
            raise GitHubError("profile fetch failed") from e
        return GitHubProfile(id=str(data["id"]), login=data.get("login"))

    def list_repos(self, token: str) -> list[GitHubRepo]:
        """Repos this user token can reach: those in the App's installations
        that the user also has access to."""
        repos: dict[int, GitHubRepo] = {}
        try:
            with self._http() as http:
                for inst in self._paged(
                    http, token, "/user/installations", "installations"
                ):
                    path = f"/user/installations/{inst['id']}/repositories"
                    for repo in self._paged(http, token, path, "repositories"):
                        repos[repo["id"]] = GitHubRepo(
                            full_name=repo["full_name"],
                            private=repo["private"],
                            html_url=repo["html_url"],
                        )
        except (httpx.HTTPError, ValueError, KeyError) as e:
            raise GitHubError("repo listing failed") from e
        return sorted(repos.values(), key=lambda r: r.full_name.lower())

    def _paged(self, http: httpx.Client, token: str, path: str, key: str) -> list[dict]:
        items: list[dict] = []
        page = 1
        while True:
            data = self._get(http, token, path, per_page=PAGE_SIZE, page=page)
            items.extend(data[key])
            if len(data[key]) < PAGE_SIZE or len(items) >= data["total_count"]:
                return items
            page += 1


def get_github_client() -> GitHubClient:
    settings = get_settings()
    return GitHubClient(
        client_id=settings.github_client_id,
        client_secret=settings.github_client_secret.get_secret_value(),
        redirect_uri=settings.github_redirect_uri,
    )
