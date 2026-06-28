import sys
import asyncio
from contextlib import asynccontextmanager
import os

# Prevent event loop crashes on Windows
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    try:
        import uvicorn.loops.asyncio
        uvicorn.loops.asyncio.asyncio_setup = lambda: None
    except Exception:
        pass

# Disable ChromaDB Telemetry background loops to prevent shutdown hangs
os.environ["ANONYMIZED_TELEMETRY"] = "False"
os.environ["CHROMA_TELEMETRY_ANONYMIZED"] = "False"

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.services.rag_service import init_vector_db
from app.services.database import init_db
from app.api.endpoints import router

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Startup: Vector DB 및 SQLite DB 초기화를 시작합니다.")
    init_vector_db()
    init_db()
    yield
    print("Shutdown: 시스템을 종료합니다.")

app = FastAPI(title="Phishing Security SaaS Backend API", lifespan=lifespan)

# Allow credentials with a regex origin policy for Chrome extensions and any web domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8002",
        "http://127.0.0.1:8002",
    ],
    allow_origin_regex=r"chrome-extension://.*|https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

# Resolve frontend folder path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# Serve frontend static assets if they exist
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
def read_root():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"status": "ok", "message": "Phishing Security SaaS Backend API is running"}

