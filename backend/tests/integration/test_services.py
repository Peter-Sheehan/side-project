import os

import psycopg
import redis

POSTGRES_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://app:password@localhost:5432/appdb",
)

REDIS_URL = os.getenv(
    "REDIS_URL",
    "redis://localhost:6379",
)


def test_postgres():
    print("\n--- PostgreSQL ---")

    # Read-only check: creating tables here leaks them into Alembic autogenerate.
    with psycopg.connect(POSTGRES_URL) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT %s", ("Hello from Docker!",))
            message = cursor.fetchone()[0]

    print("Sent:     Hello from Docker!")
    print(f"Retrieved: {message}")
    assert message == "Hello from Docker!"


def test_redis():
    print("\n--- Redis ---")

    client = redis.from_url(REDIS_URL, decode_responses=True)

    client.set("test_message", "Hello from Redis!")

    message = client.get("test_message")

    print("Sent:      Hello from Redis!")
    print(f"Retrieved: {message}")

    client.close()


if __name__ == "__main__":
    try:
        test_postgres()
        print("PostgreSQL: OK")
    except Exception as e:
        print(f"PostgreSQL: FAILED - {e}")

    try:
        test_redis()
        print("Redis: OK")
    except Exception as e:
        print(f"Redis: FAILED - {e}")
