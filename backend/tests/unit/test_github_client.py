"""GitHubClient against a fake transport: what it sends and how it reads GitHub's replies."""

from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.features.integrations.github.client import (
    GitHubAuthError,
    GitHubClient,
    GitHubError,
    GitHubNotFound,
    GitHubRateLimited,
)


def _client(handler) -> GitHubClient:
    return GitHubClient(
        "cid", "secret", "http://test/callback", transport=httpx.MockTransport(handler)
    )


def test_authorize_url_includes_pkce_and_state():
    url = GitHubClient("cid", "secret", "http://test/callback").authorize_url(
        "st", "chal"
    )
    qs = parse_qs(urlparse(url).query)
    assert qs == {
        "client_id": ["cid"],
        "redirect_uri": ["http://test/callback"],
        "state": ["st"],
        "code_challenge": ["chal"],
        "code_challenge_method": ["S256"],
    }


def test_exchange_code_returns_tokens_with_expiry():
    def handler(request):
        body = parse_qs(request.content.decode())
        assert body["code"] == ["the-code"] and body["code_verifier"] == ["ver"]
        assert body["client_secret"] == ["secret"]
        return httpx.Response(
            200,
            json={
                "access_token": "ghu_x",
                "refresh_token": "ghr_x",
                "expires_in": 28800,
            },
        )

    tokens = _client(handler).exchange_code("the-code", "ver")
    assert tokens.access_token == "ghu_x" and tokens.refresh_token == "ghr_x"
    assert tokens.expires_at is not None


def test_exchange_code_raises_on_error_in_200_response():
    # GitHub reports a bad code as HTTP 200 with an "error" field.
    def handler(request):
        return httpx.Response(
            200,
            json={"error": "bad_verification_code", "error_description": "bad code"},
        )

    with pytest.raises(GitHubError, match="bad code"):
        _client(handler).exchange_code("x", "y")


def test_network_failure_raises_github_error():
    def handler(request):
        raise httpx.ConnectError("down")

    with pytest.raises(GitHubError):
        _client(handler).fetch_profile("tok")


def test_fetch_profile_uses_numeric_id_as_string():
    def handler(request):
        assert request.headers["Authorization"] == "Bearer tok"
        return httpx.Response(200, json={"id": 4242, "login": "octocat"})

    profile = _client(handler).fetch_profile("tok")
    assert profile.id == "4242" and profile.login == "octocat"


def test_refresh_sends_refresh_grant():
    def handler(request):
        body = parse_qs(request.content.decode())
        assert body["grant_type"] == ["refresh_token"]
        assert body["refresh_token"] == ["ghr_old"]
        return httpx.Response(
            200,
            json={
                "access_token": "ghu_new",
                "refresh_token": "ghr_new",
                "expires_in": 60,
            },
        )

    tokens = _client(handler).refresh("ghr_old")
    assert tokens.access_token == "ghu_new" and tokens.refresh_token == "ghr_new"


def test_list_repos_covers_every_installation_and_dedupes():
    def repo(id, name, private=False):
        return {
            "id": id,
            "full_name": name,
            "private": private,
            "html_url": f"https://github.com/{name}",
        }

    def handler(request):
        assert request.headers["Authorization"] == "Bearer tok"
        if request.url.path == "/user/installations":
            return httpx.Response(
                200, json={"total_count": 2, "installations": [{"id": 1}, {"id": 2}]}
            )
        if request.url.path == "/user/installations/1/repositories":
            return httpx.Response(
                200,
                json={
                    "total_count": 2,
                    "repositories": [repo(10, "org/b"), repo(11, "org/A", True)],
                },
            )
        return httpx.Response(
            200, json={"total_count": 1, "repositories": [repo(10, "org/b")]}
        )

    repos = _client(handler).list_repos("tok")
    assert [r.full_name for r in repos] == ["org/A", "org/b"]
    assert repos[0].private is True


def test_list_repos_raises_on_revoked_token():
    def handler(request):
        return httpx.Response(401, json={"message": "Bad credentials"})

    with pytest.raises(GitHubError):
        _client(handler).list_repos("tok")


def test_401_raises_auth_error():
    def handler(request):
        return httpx.Response(401, json={"message": "Bad credentials"})

    with pytest.raises(GitHubAuthError):
        _client(handler).fetch_profile("tok")


def test_bad_refresh_token_raises_auth_error():
    def handler(request):
        return httpx.Response(200, json={"error": "bad_refresh_token"})

    with pytest.raises(GitHubAuthError):
        _client(handler).refresh("ghr_old")


def test_server_error_is_not_an_auth_error():
    def handler(request):
        return httpx.Response(500)

    with pytest.raises(GitHubError) as e:
        _client(handler).fetch_profile("tok")
    assert not isinstance(e.value, GitHubAuthError)


def _repo_json(**extra):
    return {
        "full_name": "octo/hello",
        "description": "Hi",
        "html_url": "https://github.com/octo/hello",
        "private": False,
        "default_branch": "main",
        "language": "Python",
        "stargazers_count": 3,
        "forks_count": 1,
        **extra,
    }


def test_view_repo_lists_dirs_first_and_sends_no_token_when_anonymous():
    def handler(request):
        assert "Authorization" not in request.headers
        if request.url.path == "/repos/octo/hello":
            return httpx.Response(200, json=_repo_json())
        assert request.url.path == "/repos/octo/hello/contents"
        return httpx.Response(
            200,
            json=[
                {"name": "README.md", "type": "file", "html_url": "u1"},
                {"name": "src", "type": "dir", "html_url": "u2"},
            ],
        )

    view = _client(handler).view_repo(None, "octo", "hello")
    assert view.full_name == "octo/hello" and view.stars == 3
    assert [f.name for f in view.files] == ["src", "README.md"]


def test_view_repo_of_empty_repo_has_no_files():
    def handler(request):
        if request.url.path == "/repos/octo/hello":
            return httpx.Response(200, json=_repo_json())
        return httpx.Response(404, json={"message": "This repository is empty."})

    assert _client(handler).view_repo("tok", "octo", "hello").files == []


def test_view_repo_missing_raises_not_found():
    def handler(request):
        return httpx.Response(404, json={"message": "Not Found"})

    with pytest.raises(GitHubNotFound):
        _client(handler).view_repo(None, "octo", "nope")


def test_rate_limit_raises_rate_limited():
    def handler(request):
        return httpx.Response(403, headers={"x-ratelimit-remaining": "0"})

    with pytest.raises(GitHubRateLimited):
        _client(handler).view_repo(None, "octo", "hello")
