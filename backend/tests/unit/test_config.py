import pytest
from pydantic import ValidationError

from app.core.config import Settings


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("http://localhost:3000", "http://localhost:3000"),
        ("http://203.0.113.10:3000/", "http://203.0.113.10:3000"),
        (" https://example.com ", "https://example.com"),
    ],
)
def test_public_url_is_normalised_to_an_origin(value, expected):
    assert Settings(frontend_url=value).frontend_url == expected


@pytest.mark.parametrize(
    "value",
    [
        "http://docker-vm:3000/app",  # a path breaks every redirect built from it
        "http://localhost:3000?x=1",
        "localhost:3000",  # no scheme
        "docker-vm",
    ],
)
def test_public_url_must_be_a_bare_http_origin(value):
    with pytest.raises(ValidationError, match="frontend_url"):
        Settings(frontend_url=value)
