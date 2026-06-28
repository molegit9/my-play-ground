# websocket_manager.py - WebSocket 커넥션 관리 및 Redis Pub/Sub 중계 모듈

import asyncio
import json
import logging
from typing import Dict, List, Set, Any
from fastapi import WebSocket
from redis.asyncio import Redis, ConnectionError as RedisConnectionError

# 로깅 설정
logger = logging.getLogger("co-whiteboard.websocket_manager")
logger.setLevel(logging.INFO)

class ConnectionManager:
    """룸(Room) 단위로 WebSocket 커넥션을 관리하고 Redis Pub/Sub을 통해 멀티 인스턴스 환경에서 이벤트를 전파합니다."""

    def __init__(self, redis_url: str) -> None:
        self.redis_url: str = redis_url
        self.redis: Redis | None = None
        # 각 룸 ID 별 로컬 WebSocket 클라이언트 집합
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # 각 WebSocket에 바인딩된 user_id 맵핑
        self.websocket_to_user: Dict[WebSocket, str] = {}
        # 각 룸 ID 별 Redis 구독 백그라운드 태스크
        self.pubsub_tasks: Dict[str, asyncio.Task[None]] = {}
        # 각 룸 ID 별 PubSub 채널 객체
        self.pubsubs: Dict[str, Any] = {}

    async def connect_redis(self) -> None:
        """Redis 서버에 연결합니다. 실패 시 ConnectionError를 발생시킵니다."""
        try:
            self.redis = Redis.from_url(self.redis_url, decode_responses=True)
            # Redis 서버 응답 확인 (Ping)
            await self.redis.ping()
            logger.info("Connected to Redis successfully.")
        except (RedisConnectionError, Exception) as e:
            logger.error(f"Redis connection failed: {e}")
            self.redis = None
            raise ConnectionError(f"Redis connection failed: {e}") from e

    async def disconnect_redis(self) -> None:
        """Redis 연결을 종료합니다."""
        if self.redis:
            await self.redis.close()
            logger.info("Redis connection closed.")

    async def connect(self, websocket: WebSocket, room_id: str, user_id: str) -> None:
        """새 클라이언트 WebSocket 연결을 수락하고 룸에 등록합니다.
        룸의 첫 접속자일 경우 Redis 구독을 시작합니다.
        """
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = set()
        self.active_connections[room_id].add(websocket)
        self.websocket_to_user[websocket] = user_id
        logger.info(f"Client connected. Room: {room_id}, User: {user_id}, Active clients on this node: {len(self.active_connections[room_id])}")

        # 방에 첫 접속자가 생기면 Redis 구독 기동
        if len(self.active_connections[room_id]) == 1:
            await self._start_room_subscription(room_id)

        # Redis Set에 유저 추가 및 전체 유저 수 갱신 브로드캐스트
        if self.redis:
            try:
                await self.redis.sadd(f"room:{room_id}:users", user_id)
                await self._broadcast_room_user_count(room_id)
            except Exception as e:
                logger.error(f"Redis sadd/broadcast error: {e}")

    async def disconnect(self, websocket: WebSocket, room_id: str) -> None:
        """클라이언트 WebSocket 연결 해제를 처리합니다.
        룸에 더 이상 접속자가 없으면 Redis 구독을 해제합니다.
        """
        if room_id in self.active_connections:
            self.active_connections[room_id].discard(websocket)
            logger.info(f"Client disconnected. Room: {room_id}, Active clients remaining on this node: {len(self.active_connections[room_id])}")
            
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]
                # 방에 접속자가 더 이상 없으면 Redis 구독 해제
                await self._stop_room_subscription(room_id)
        
        user_id = self.websocket_to_user.pop(websocket, None)
        if user_id and self.redis:
            try:
                await self.redis.srem(f"room:{room_id}:users", user_id)
                # 현재 남은 인원수 확인
                count = await self.redis.scard(f"room:{room_id}:users")
                if count == 0:
                    # 방에 인원이 더 이상 없으면 방 목록(Redis Hash)에서 제거하여 자동 청소
                    await self.redis.hdel("whiteboard:rooms", room_id)
                    logger.info(f"Room {room_id} has become empty. Cleaned up room registry.")
                else:
                    await self._broadcast_room_user_count(room_id)
            except Exception as e:
                logger.error(f"Redis srem/broadcast/cleanup error: {e}")

    async def _broadcast_room_user_count(self, room_id: str) -> None:
        """현재 룸의 활성 유저 수를 구하여 전체 노드에 브로드캐스트합니다."""
        if not self.redis:
            return
        try:
            count = await self.redis.scard(f"room:{room_id}:users")
            from datetime import datetime, timezone
            await self.publish_message(room_id, {
                "type": "user_count",
                "payload": {
                    "count": count
                },
                "user_id": "system",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        except Exception as e:
            logger.error(f"Failed to query/broadcast room user count: {e}")

    async def publish_message(self, room_id: str, message: Dict[str, Any]) -> None:
        """이벤트를 Redis 룸 채널에 발행(Publish)합니다.
        이 메서드는 로컬 클라이언트로부터 이벤트를 받았을 때 호출됩니다.
        """
        if not self.redis:
            logger.warning("Redis is not connected. Attempting to reconnect...")
            await self.connect_redis()

        assert self.redis is not None
        channel = f"room:{room_id}"
        try:
            await self.redis.publish(channel, json.dumps(message))
        except Exception as e:
            logger.error(f"Failed to publish message to Redis room {room_id}: {e}")
            raise ConnectionError(f"Redis publish failed: {e}") from e

    async def broadcast_local(self, room_id: str, message: Dict[str, Any]) -> None:
        """해당 서버 노드에 직접 접속 중인 모든 로컬 WebSocket 클라이언트에게 메시지를 전송합니다."""
        if room_id not in self.active_connections:
            return

        closed_connections: List[WebSocket] = []
        # 동시 전송 시 예외 발생을 방지하기 위해 복사본 생성 후 순회
        for ws in list(self.active_connections[room_id]):
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send message to local client: {e}")
                closed_connections.append(ws)

        # 오류 발생한 커넥션들 정리
        for ws in closed_connections:
            await self.disconnect(ws, room_id)

    async def _start_room_subscription(self, room_id: str) -> None:
        """Redis 룸 채널을 구독하고, 백그라운드에서 리스너 루프를 실행합니다."""
        if not self.redis:
            await self.connect_redis()

        assert self.redis is not None
        pubsub = self.redis.pubsub()
        channel = f"room:{room_id}"
        await pubsub.subscribe(channel)
        self.pubsubs[room_id] = pubsub

        # 백그라운드 태스크로 리스너 루프 실행
        task = asyncio.create_task(self._listen_pubsub_loop(room_id, pubsub))
        self.pubsub_tasks[room_id] = task
        logger.info(f"Subscribed to Redis channel: {channel}")

    async def _stop_room_subscription(self, room_id: str) -> None:
        """Redis 구독을 취소하고 백그라운드 리스너 태스크를 중지합니다."""
        task = self.pubsub_tasks.pop(room_id, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        pubsub = self.pubsubs.pop(room_id, None)
        if pubsub:
            channel = f"room:{room_id}"
            await pubsub.unsubscribe(channel)
            await pubsub.close()
            logger.info(f"Unsubscribed from Redis channel: {channel}")

    async def _listen_pubsub_loop(self, room_id: str, pubsub: Any) -> None:
        """Redis Pub/Sub 메세지 루프. 들어오는 메세지를 수신하여 로컬 클라이언트들에게 브로드캐스트합니다."""
        try:
            async for message in pubsub.listen():
                if message and message.get("type") == "message":
                    try:
                        data = json.loads(message["data"])
                        await self.broadcast_local(room_id, data)
                    except json.JSONDecodeError as je:
                        logger.error(f"JSON decoding error for Redis message: {je}")
                    except Exception as e:
                        logger.error(f"Error distributing message from Redis: {e}")
        except asyncio.CancelledError:
            # 정상적인 태스크 중단
            pass
        except Exception as e:
            logger.error(f"Exception in Redis pubsub listener loop for room {room_id}: {e}")
