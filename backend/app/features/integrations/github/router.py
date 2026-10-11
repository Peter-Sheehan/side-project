from typing import Annotated, Literal

from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.api.deps import CurrentUser, DbSession, RedisClient
from app.core.config import get_settings
from app.features.integrations.github import service
from app.features.integrations.github.client import (
    GitHubClient,
    GitHubError,
    get_github_client,
)

# Connects a signed-in user's GitHub account for repository access.
router = APIRouter(prefix="/integrations/github", tags=["github"])

STATE_COOKIE = "oauth_state"
GitHub = Annotated[GitHubClient, Depends(get_github_client)]


REVOKED = "GitHub access was revoked or expired. Link GitHub again."


class GitHubLink(BaseModel):
    status: Literal["linked", "unlinked", "revoked"]
    login: str | None


class GitHubRepoOut(BaseModel):
    full_name: str
    private: bool
    html_url: str


def _redirect(path: str) -> RedirectResponse:
    resp = RedirectResponse(f"{get_settings().frontend_url}{path}", status_code=302)
    resp.delete_cookie(STATE_COOKIE)
    return resp


@router.get("/link")
def github_link(user: CurrentUser, r: RedisClient, github: GitHub) -> RedirectResponse:
    if not github.configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "GitHub is not configured."
        )
    url, state = service.start_link(r, github, user.id)
    resp = RedirectResponse(url, status_code=302)
    resp.set_cookie(
        STATE_COOKIE,
        state,
        max_age=service.STATE_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=get_settings().cookie_secure,
    )
    return resp


@router.get("/callback")
def github_callback(
    db: DbSession,
    r: RedisClient,
    github: GitHub,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    oauth_state: Annotated[str | None, Cookie(alias=STATE_COOKIE)] = None,
) -> RedirectResponse:
    if error or not code or not state:
        return _redirect("/settings?error=github_denied")
    try:
        service.complete_link(
            db, r, github, code=code, state=state, browser_state=oauth_state
        )
    except service.LinkError as e:
        return _redirect(f"/settings?error={e.reason}")
    return _redirect("/settings?linked=github")


@router.get("", response_model=GitHubLink)
def read_github_link(user: CurrentUser, db: DbSession, github: GitHub) -> GitHubLink:
    """Whether the user's GitHub is linked, checked against GitHub. "revoked"
    means it was linked but GitHub stopped accepting it, so it was removed."""
    try:
        conn = service.check_link(db, github, user.id)
    except service.LinkRevoked:
        return GitHubLink(status="revoked", login=None)
    if conn is None:
        return GitHubLink(status="unlinked", login=None)
    return GitHubLink(status="linked", login=conn.provider_login)


@router.get(
    "/repos",
    response_model=list[GitHubRepoOut],
    responses={409: {"description": "GitHub access was revoked; link it again."}},
)
def list_github_repos(
    user: CurrentUser, db: DbSession, github: GitHub
) -> list[GitHubRepoOut]:
    try:
        repos = service.list_repos(db, github, user.id)
    except service.LinkRevoked as e:
        raise HTTPException(status.HTTP_409_CONFLICT, REVOKED) from e
    except GitHubError as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Couldn't list repositories from GitHub."
        ) from e
    if repos is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "GitHub is not linked.")
    return [GitHubRepoOut(**vars(r)) for r in repos]


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def unlink_github(user: CurrentUser, db: DbSession) -> None:
    if not service.unlink(db, user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "GitHub is not linked.")
