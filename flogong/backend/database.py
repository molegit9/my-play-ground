from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from backend.config import DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, USE_SQLITE
import urllib.parse

# Construct Async Database URL
if USE_SQLITE:
    DATABASE_URL = "sqlite+aiosqlite:///./flappygame.db"
else:
    # URL-encode password to handle special characters safely
    encoded_pass = urllib.parse.quote_plus(DB_PASS)
    DATABASE_URL = f"mysql+aiomysql://{DB_USER}:{encoded_pass}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# Create Async Engine
# For SQLite, specify check_same_thread=False
connect_args = {"check_same_thread": False} if USE_SQLITE else {}
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args=connect_args,
    pool_pre_ping=True
)

# Async Session Factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

Base = declarative_base()

# Dependency for FastAPI endpoints
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
