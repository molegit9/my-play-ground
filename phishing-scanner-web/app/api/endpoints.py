from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, HttpUrl
from typing import Optional

from app.services.url_service import analyze_web_url
from app.services.rag_service import analyze_web_text
from app.services.database import get_recent_logs, init_db

router = APIRouter()

# --- Pydantic Models for Web Interface ---
class WebURLRequest(BaseModel):
    url: str
    enable_deep_scan: Optional[bool] = True

class WebTextRequest(BaseModel):
    text: str

# --- Endpoints ---
@router.post("/api/web/scan/url")
async def scan_url(req: WebURLRequest):
    """
    [URL 위협 분석 API]
    전달된 URL의 Levenshtein 사칭, RDAP 생성일, VirusTotal Reputation, Playwright 정/동적 HTML 요소를 종합 판별하여
    분석 진행 과정과 최종 판정 점수를 NDJSON 스트림 형태로 실시간 반환합니다.
    """
    try:
        generator = analyze_web_url(url=req.url, enable_deep_scan=req.enable_deep_scan)
        return StreamingResponse(generator, media_type="application/x-ndjson")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/web/scan/text")
async def scan_text(req: WebTextRequest):
    """
    [사회공학적 텍스트 위협 분석 API]
    과거 피싱 판례 RAG 검색 결과를 조합하여 스미싱, 피싱 등 사회공학적 사기 의도를 분석하고
    진행 상태 및 최종 결과를 NDJSON 스트림 형태로 실시간 반환합니다.
    """
    try:
        generator = analyze_web_text(text=req.text)
        return StreamingResponse(generator, media_type="application/x-ndjson")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/web/logs")
async def get_logs(limit: int = 20):
    """최근 분석 로그 반환"""
    try:
        logs = get_recent_logs(limit=limit)
        return {"status": "success", "logs": logs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def health_check():
    """서버 상태 반환"""
    return {"status": "ok", "message": "Phishing Security SaaS Backend API is running"}
