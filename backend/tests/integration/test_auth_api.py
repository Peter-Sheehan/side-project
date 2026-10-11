from app.features.auth import session as auth
from app.features.auth.session import SESSION_COOKIES, AuthUser


def test_me_requires_session_cookie(client):
    assert client.get("/api/users/me").status_code == 401


def test_me_returns_better_auth_user(client, sign_in):
    sign_in("ba_alice", "alice@example.com")
    r = client.get("/api/users/me")
    assert r.status_code == 200
    assert r.json() == {"id": "ba_alice", "email": "alice@example.com", "name": None}


def test_unknown_session_is_rejected(client, monkeypatch):
    monkeypatch.setattr(auth, "fetch_session_user", lambda cookie: None)
    client.cookies.set(SESSION_COOKIES[0], "expired")
    assert client.get("/api/users/me").status_code == 401


def test_session_lookup_is_cached(client, monkeypatch):
    calls = []

    def fake_fetch(cookie):
        calls.append(cookie)
        return AuthUser(id="ba_alice", email="alice@example.com")

    monkeypatch.setattr(auth, "fetch_session_user", fake_fetch)
    client.cookies.set(SESSION_COOKIES[0], "tok")
    for _ in range(3):
        assert client.get("/api/users/me").status_code == 200
    assert len(calls) == 1


def test_auth_service_down_gives_503(client, monkeypatch):
    def down(cookie):
        raise auth.AuthServiceUnavailable

    monkeypatch.setattr(auth, "fetch_session_user", down)
    client.cookies.set(SESSION_COOKIES[0], "tok")
    assert client.get("/api/users/me").status_code == 503
