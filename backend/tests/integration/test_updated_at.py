import uuid

from app.core.db import get_sessionmaker
from app.features.integrations.models import ProviderConnection


def test_updated_at_changes_on_update():
    with get_sessionmaker()() as db:
        conn = ProviderConnection(
            user_id=f"test-{uuid.uuid4()}",
            provider="github",
            provider_user_id=uuid.uuid4().hex[:32],
        )
        db.add(conn)
        try:
            db.commit()
            created = conn.updated_at
            conn.provider_login = "renamed"
            db.commit()
            db.refresh(conn)
            assert conn.updated_at > created
        finally:
            db.delete(conn)
            db.commit()
