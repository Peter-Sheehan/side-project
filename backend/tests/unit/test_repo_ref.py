"""Parsing what users paste into "View a repository"."""

import pytest

from app.features.integrations.github.service import parse_repo_ref


@pytest.mark.parametrize(
    "text",
    [
        "https://github.com/octo/hello",
        "https://github.com/octo/hello/",
        "https://github.com/octo/hello.git",
        "http://www.github.com/octo/hello/tree/main/src",
        "github.com/octo/hello?tab=readme",
        "  octo/hello  ",
    ],
)
def test_parse_repo_ref_accepts_common_forms(text):
    assert parse_repo_ref(text) == ("octo", "hello")


def test_parse_repo_ref_keeps_dots_in_names():
    assert parse_repo_ref("https://github.com/octo/my.site") == ("octo", "my.site")


@pytest.mark.parametrize(
    "text",
    ["", "octo", "https://gitlab.com/octo/hello", "https://github.com/octo", "../x/y"],
)
def test_parse_repo_ref_rejects_other_input(text):
    assert parse_repo_ref(text) is None
