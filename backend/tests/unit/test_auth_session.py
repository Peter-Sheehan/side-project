"""fetch_session_user against a faked httpx.get: what it asks Better Auth and
how it reads the reply."""

import httpx

from app.features.auth import session as auth
from app.features.auth.session import AuthUser


def _fake_get(monkeypatch, status=200, body="null"):
    seen = {}

    def fake_get(url, params, headers, timeout):
        seen.update(url=url, params=params, headers=headers)
        return httpx.Response(status, text=body, request=httpx.Request("GET", url))

    monkeypatch.setattr(auth.httpx, "get", fake_get)
    return seen


def test_fetch_session_user_parses_better_auth_response(monkeypatch, override_settings):
    override_settings(AUTH_SERVICE_URL="http://auth:3001/")
    seen = _fake_get(
        monkeypatch,
        body='{"session": {"id": "s1"}, "user": {"id": "ba_1", "email": "a@b.co",'
        ' "name": "A", "emailVerified": true}}',
    )
    user = auth.fetch_session_user("better-auth.session_token=abc")
    assert user == AuthUser(id="ba_1", email="a@b.co", name="A")
    assert seen["url"] == "http://auth:3001/api/auth/get-session"
    assert seen["params"] == {"disableRefresh": "true"}  # must not extend the session
    assert seen["headers"] == {"Cookie": "better-auth.session_token=abc"}


def test_fetch_session_user_returns_none_when_signed_out(monkeypatch):
    _fake_get(monkeypatch, body="null")
    assert auth.fetch_session_user("better-auth.session_token=abc") is None


def test_fetch_session_user_raises_when_auth_service_errors(monkeypatch):
    _fake_get(monkeypatch, status=500, body="oops")
    try:
        auth.fetch_session_user("better-auth.session_token=abc")
    except auth.AuthServiceUnavailable:
        pass
    else:
        raise AssertionError("expected AuthServiceUnavailable")
