import os

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", 3306))
DB_USER = os.getenv("DB_USER", "root")
DB_PASS = os.getenv("DB_PASS", "password")
DB_NAME = os.getenv("DB_NAME", "flappygame")

# Determine if we should fallback to SQLite for local development
USE_SQLITE = os.getenv("USE_SQLITE", "true").lower() == "true"
