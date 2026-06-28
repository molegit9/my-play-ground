# ocr_service.py - EasyOCR 연동 및 비동기 처리 모듈

import asyncio
import base64
import io
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Tuple
from PIL import Image
import numpy as np
import easyocr
from websocket_manager import ConnectionManager

# 로깅 설정
logger = logging.getLogger("co-whiteboard.ocr_service")
logger.setLevel(logging.INFO)

class OCRService:
    """EasyOCR을 사용하여 이미지에서 텍스트를 추출하고 결과를 WebSocket으로 브로드캐스트합니다."""

    def __init__(self, websocket_manager: ConnectionManager) -> None:
        self.manager: ConnectionManager = websocket_manager
        self.reader: easyocr.Reader | None = None

    def _get_reader(self) -> easyocr.Reader:
        """EasyOCR Reader를 지연 초기화(Lazy Initialization) 방식으로 가져옵니다."""
        if self.reader is None:
            logger.info("Initializing EasyOCR Reader (CPU mode)...")
            # 영어('en') 및 한국어('ko') 지원, GPU 사용 안 함(gpu=False)
            self.reader = easyocr.Reader(["ko", "en"], gpu=False)
            logger.info("EasyOCR Reader initialized.")
        return self.reader

    def _run_ocr(self, image_bytes: bytes) -> Tuple[str, float]:
        """[동기 실행] 이미지 바이트에서 텍스트를 추출합니다."""
        try:
            reader = self._get_reader()
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            
            # PIL 이미지를 EasyOCR이 지원하는 numpy array 형태로 변환
            image_np = np.array(image)
            
            # EasyOCR 실행: 결과는 [(bbox, text, confidence), ...] 형태
            results = reader.readtext(image_np)
            
            if not results:
                return "", 1.0

            texts = [res[1] for res in results]
            confidences = [res[2] for res in results]
            
            combined_text = " ".join(texts)
            avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
            
            return combined_text, float(avg_confidence)
        except Exception as e:
            logger.error(f"Error during EasyOCR processing: {e}")
            return f"Error: {str(e)}", 0.0

    async def process_ocr(self, image_base64: str, room_id: str, sticky_id: str) -> None:
        """[비동기 실행] Base64 이미지를 디코딩하고 별도 스레드에서 OCR을 수행한 뒤, 결과를 룸의 모든 클라이언트에게 브로드캐스트합니다."""
        logger.info(f"Starting OCR task for room: {room_id}, sticky: {sticky_id}")
        try:
            # Base64 헤더 제거 (예: data:image/png;base64,...)
            if "," in image_base64:
                image_base64 = image_base64.split(",")[1]
            
            # 이미지 바이트 디코딩
            image_bytes = base64.b64decode(image_base64)
            
            # CPU 부하 방지를 위해 run_in_executor로 동기 함수를 별도 스레드에서 비동기 실행
            loop = asyncio.get_running_loop()
            text, confidence = await loop.run_in_executor(None, self._run_ocr, image_bytes)
            
            logger.info(f"OCR Task Completed. Room: {room_id}, Sticky: {sticky_id}, Text: '{text}', Confidence: {confidence:.2f}")

            # WebSocket 메시지 포맷 정의
            ocr_message: Dict[str, Any] = {
                "type": "ocr_result",
                "payload": {
                    "sticky_id": sticky_id,
                    "text": text,
                    "confidence": confidence
                },
                "user_id": "system_ocr",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            
            # Redis를 통해 해당 방의 모든 노드/클라이언트에 브로드캐스트
            await self.manager.publish_message(room_id, ocr_message)

        except Exception as e:
            logger.error(f"Failed to process OCR task: {e}")
            # 에러 발생 시에도 결과 공지 브로드캐스트
            error_message: Dict[str, Any] = {
                "type": "ocr_result",
                "payload": {
                    "sticky_id": sticky_id,
                    "text": f"Failed to recognize text: {str(e)}",
                    "confidence": 0.0
                },
                "user_id": "system_ocr",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            try:
                await self.manager.publish_message(room_id, error_message)
            except Exception as pe:
                logger.error(f"Failed to publish OCR error message to Redis: {pe}")
