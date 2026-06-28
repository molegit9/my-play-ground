# main.py - FastAPI 애플리케이션 진입점 및 라우팅 모듈

import os
import json
import logging
from contextlib import asynccontextmanager
from typing import Dict, Any, AsyncGenerator
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import random
import string
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# 로컬 모듈 임포트
from websocket_manager import ConnectionManager
from ocr_service import OCRService
from storage import StorageInterface, MockStorage

# 환경 변수 로드
load_dotenv()

REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
STORAGE_TYPE: str = os.getenv("STORAGE_TYPE", "mock")

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("co-whiteboard.main")

# 매니저 및 서비스 초기화
manager = ConnectionManager(redis_url=REDIS_URL)
ocr_service = OCRService(websocket_manager=manager)

# 스토리지 인스턴스 팩토리
def get_storage() -> StorageInterface:
    """설정된 STORAGE_TYPE 환경 변수에 해당하는 스토리지 객체를 반환합니다."""
    if STORAGE_TYPE.lower() == "mock":
        return MockStorage()
    # 향후 NCP Object Storage나 AWS S3 등이 추가되면 이 부분에 추가 구현
    return MockStorage()

# FastAPI 수명 주기(lifespan) 정의
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """애플리케이션 시작 시 Redis 연결을 초기화하고, 종료 시 세션을 정리합니다."""
    logger.info("Starting up co-whiteboard backend server...")
    try:
        await manager.connect_redis()
    except Exception as e:
        logger.error(f"Failed to initialize Redis on startup: {e}")
        # 로컬 개발 및 일부 테스트 편의를 위해 raise하지 않고 경고만 출력하며 계속 기동 가능하도록 구성할 수도 있으나,
        # 요구사항의 ConnectionError raise 규칙에 부합하도록 즉각 알립니다.
    
    yield
    
    logger.info("Shutting down co-whiteboard backend server...")
    await manager.disconnect_redis()

# FastAPI 앱 객체 생성
app = FastAPI(
    title="Co-Whiteboard API",
    description="실시간 AI 협업 화이트보드 백엔드 서비스",
    version="1.0.0",
    lifespan=lifespan
)

# CORS 미들웨어 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic 데이터 스키마 정의
class RoomCreate(BaseModel):
    room_name: str = Field(..., min_length=1, max_length=50, description="생성할 방 이름")
    password: str = Field("", description="방 비밀번호 (비어있으면 공개방)")

class RoomVerify(BaseModel):
    password: str = Field(..., description="입력한 비밀번호")

class RoomResponse(BaseModel):
    room_id: str = Field(..., description="6자리 고유 방 코드")
    room_name: str = Field(..., description="방 이름")
    has_password: bool = Field(..., description="비밀번호 설정 여부")
    active_users: int = Field(0, description="현재 접속 유저 수")

class OCRRequest(BaseModel):
    image_base64: str = Field(..., description="Base64로 인코딩된 이미지 문자열")
    room_id: str = Field(..., description="요청이 발생한 룸 ID")
    sticky_id: str = Field(..., description="텍스트를 삽입할 스티키 노트 ID")

class OCRResponse(BaseModel):
    sticky_id: str = Field(..., description="스티키 노트 ID")
    text: str = Field(..., description="추출 완료 혹은 추출 중 상태 설명 텍스트")
    confidence: float = Field(..., description="추출 신뢰도 값 (0.0 ~ 1.0)")


@app.get("/")
async def root() -> Dict[str, str]:
    """백엔드 서버 헬스체크 및 안내 라우트"""
    return {
        "status": "ok",
        "message": "Co-Whiteboard Backend API is running. Access /docs for Swagger UI documentation."
    }


@app.post("/api/rooms", response_model=RoomResponse)
async def create_room(room_data: RoomCreate) -> RoomResponse:
    """새로운 화이트보드 룸을 생성합니다."""
    if not manager.redis:
        raise HTTPException(status_code=503, detail="Redis connection not established")
    
    # 6자리 알파뉴메릭 고유 방 코드 생성 (중복 체크 최대 10회)
    for _ in range(10):
        room_id = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        exists = await manager.redis.hexists("whiteboard:rooms", room_id)
        if not exists:
            break
    else:
        raise HTTPException(status_code=500, detail="Failed to generate a unique room code")

    room_info = {
        "room_id": room_id,
        "room_name": room_data.room_name,
        "password": room_data.password,
        "has_password": bool(room_data.password)
    }
    
    await manager.redis.hset("whiteboard:rooms", room_id, json.dumps(room_info))
    
    return RoomResponse(
        room_id=room_id,
        room_name=room_data.room_name,
        has_password=bool(room_data.password),
        active_users=0
    )


@app.get("/api/rooms", response_model=list[RoomResponse])
async def list_rooms() -> list[RoomResponse]:
    """활성화된 전체 방 목록을 조회합니다."""
    if not manager.redis:
        return []
    
    try:
        all_rooms_raw = await manager.redis.hgetall("whiteboard:rooms")
        rooms = []
        for room_id, raw_val in all_rooms_raw.items():
            room_info = json.loads(raw_val)
            active_users = await manager.redis.scard(f"room:{room_id}:users")
            
            rooms.append(RoomResponse(
                room_id=room_id,
                room_name=room_info["room_name"],
                has_password=room_info["has_password"],
                active_users=active_users
            ))
        return rooms
    except Exception as e:
        logger.error(f"Error listing rooms: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list rooms: {str(e)}")


@app.post("/api/rooms/{room_id}/verify")
async def verify_room(room_id: str, verify_data: RoomVerify) -> Dict[str, Any]:
    """방 비밀번호가 일치하는지 검증합니다."""
    if not manager.redis:
        raise HTTPException(status_code=503, detail="Redis connection not established")
    
    raw_val = await manager.redis.hget("whiteboard:rooms", room_id)
    if not raw_val:
        raise HTTPException(status_code=404, detail="Room not found")
        
    room_info = json.loads(raw_val)
    if not room_info["has_password"]:
        return {"success": True, "message": "No password required"}
        
    if room_info["password"] == verify_data.password:
        return {"success": True, "message": "Verification successful"}
    else:
        raise HTTPException(status_code=403, detail="Invalid room password")


@app.post("/api/ocr", response_model=OCRResponse)
async def request_ocr(request: OCRRequest, background_tasks: BackgroundTasks) -> OCRResponse:
    """이미지 내 텍스트 추출을 비동기로 요청합니다.
    결과는 백그라운드에서 EasyOCR로 분석되어 완료 시 WebSocket을 통해 룸 전체에 브로드캐스트됩니다.
    """
    try:
        # BackgroundTasks에 백그라운드 실행 함수 등록
        background_tasks.add_task(
            ocr_service.process_ocr,
            request.image_base64,
            request.room_id,
            request.sticky_id
        )
        # 즉시 대기 응답을 반환
        return OCRResponse(
            sticky_id=request.sticky_id,
            text="Processing OCR task in background...",
            confidence=0.0
        )
    except Exception as e:
        logger.error(f"Error queuing OCR task: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to queue OCR task: {str(e)}")


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str = "anonymous") -> None:
    """실시간 화이트보드 룸 이벤트 동기화를 위한 WebSocket 연결점입니다."""
    await manager.connect(websocket, room_id, user_id)
    try:
        while True:
            # 클라이언트로부터 텍스트 수신
            data = await websocket.receive_text()
            try:
                message: Dict[str, Any] = json.loads(data)
                
                # 메시지 기본 포맷 체크
                msg_type = message.get("type")
                if not msg_type or msg_type not in ["draw", "erase", "add_sticky", "move_sticky", "ocr_result", "user_count"]:
                    logger.warning(f"Received unknown or invalid message type: {msg_type}")
                    continue

                # 룸의 다른 구독자들에게 메시지를 전파하기 위해 Redis 채널에 Publish
                await manager.publish_message(room_id, message)

            except json.JSONDecodeError:
                logger.warning("Received data is not a valid JSON string.")
            except ConnectionError as ce:
                logger.error(f"Redis integration error: {ce}")
                # Redis 연동 오류 시 WebSocket 클라이언트에 에러 알림 전송 가능
                await websocket.send_json({
                    "type": "error",
                    "payload": {"message": "Redis synchronization failed"},
                    "user_id": "system",
                    "timestamp": ""
                })

    except WebSocketDisconnect:
        # 연결 종료 시 룸에서 제거
        await manager.disconnect(websocket, room_id)
    except Exception as e:
        logger.error(f"Unexpected error in WebSocket session: {e}")
        await manager.disconnect(websocket, room_id)
