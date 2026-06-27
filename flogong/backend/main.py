import os
import secrets
import string
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from datetime import datetime

from backend.config import DB_HOST, DB_PORT
from backend.database import engine, Base, get_db, AsyncSessionLocal
from backend.models import User, GameRoom as DBRoom, MatchResult
from backend.game_manager import active_rooms, GameRoom, game_loop

# Startup cleanup task
async def cleanup_playing_rooms():
    async with AsyncSessionLocal() as session:
        try:
            await session.execute(
                update(DBRoom)
                .where(DBRoom.status == "PLAYING")
                .values(status="FINISHED")
            )
            await session.commit()
            print("Successfully cleaned up left-over PLAYING rooms on startup.")
        except Exception as e:
            await session.rollback()
            print(f"Error during startup database cleanup: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Clean up playing rooms
    await cleanup_playing_rooms()
    yield

app = FastAPI(lifespan=lifespan)

# Resolve paths dynamically relative to this file
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# Pydantic schemas
class UserCreate(BaseModel):
    nickname: str

class RoomCreate(BaseModel):
    room_name: str
    is_private: bool
    user_id: int

class RoomJoin(BaseModel):
    user_id: int

# Helper to look up or reconstruct active game rooms
async def get_or_reconstruct_room(room_id: str) -> GameRoom:
    if room_id in active_rooms:
        return active_rooms[room_id]
        
    async with AsyncSessionLocal() as session:
        try:
            room_db = await session.get(DBRoom, room_id)
            if not room_db or room_db.status == "FINISHED":
                return None
                
            p1 = await session.get(User, room_db.player1_id)
            p1_nickname = p1.nickname if p1 else "Player 1"
            
            room = GameRoom(
                room_id=room_db.room_id,
                room_name=room_db.room_name,
                player1_id=room_db.player1_id,
                p1_nickname=p1_nickname
            )
            room.status = room_db.status
            
            if room_db.player2_id:
                room.player2_id = room_db.player2_id
                p2 = await session.get(User, room_db.player2_id)
                room.p2_nickname = p2.nickname if p2 else "Player 2"
                
            active_rooms[room_id] = room
            
            if room.status == "PLAYING" and (room.game_loop_task is None or room.game_loop_task.done()):
                room.game_loop_task = asyncio.create_task(game_loop(room))
                
            return room
        except Exception as e:
            print(f"Error reconstructing room {room_id}: {e}")
            return None

# HTTP Endpoints

@app.post("/api/users")
async def create_user(data: UserCreate, db: AsyncSession = Depends(get_db)):
    try:
        # Check if nickname already exists
        query = select(User).where(User.nickname == data.nickname)
        result = await db.execute(query)
        user = result.scalars().first()
        
        if user:
            return {"user_id": user.id, "nickname": user.nickname}
            
        # Create new user
        new_user = User(nickname=data.nickname)
        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)
        return {"user_id": new_user.id, "nickname": new_user.nickname}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/api/rooms")
async def create_room(data: RoomCreate, db: AsyncSession = Depends(get_db)):
    try:
        # Verify user exists
        user = await db.get(User, data.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
            
        room_id = secrets.token_hex(18)  # Generate 36-char unique ID (matches UUID length)
        
        invite_code = None
        if data.is_private:
            # Generate unique 6-char alphanumeric code
            for _ in range(10):  # Try up to 10 times to prevent collision
                code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
                check_query = select(DBRoom).where(DBRoom.invite_code == code)
                check_res = await db.execute(check_query)
                if not check_res.scalars().first():
                    invite_code = code
                    break
            if not invite_code:
                raise HTTPException(status_code=500, detail="Could not generate unique invite code")

        new_room = DBRoom(
            room_id=room_id,
            room_name=data.room_name,
            player1_id=data.user_id,
            player2_id=None,
            status="WAITING",
            is_private=data.is_private,
            invite_code=invite_code,
            created_at=datetime.utcnow()
        )
        db.add(new_room)
        await db.commit()
        
        # Instantiate in-memory GameRoom
        room = GameRoom(
            room_id=room_id,
            room_name=data.room_name,
            player1_id=data.user_id,
            p1_nickname=user.nickname
        )
        room.status = "WAITING"
        active_rooms[room_id] = room
        
        return {"room_id": room_id, "invite_code": invite_code}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/api/rooms/computer")
async def create_computer_room(data: RoomJoin, db: AsyncSession = Depends(get_db)):
    try:
        user = await db.get(User, data.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
            
        room_id = secrets.token_hex(18)
        
        new_room = DBRoom(
            room_id=room_id,
            room_name="vs 컴퓨터",
            player1_id=data.user_id,
            player2_id=-1,
            status="PLAYING",
            is_private=True,
            invite_code=None,
            created_at=datetime.utcnow()
        )
        db.add(new_room)
        await db.commit()
        
        # Instantiate in-memory GameRoom
        room = GameRoom(
            room_id=room_id,
            room_name="vs 컴퓨터",
            player1_id=data.user_id,
            p1_nickname=user.nickname
        )
        room.player2_id = -1
        room.p2_nickname = "AI 컴퓨터"
        room.status = "PLAYING"
        
        active_rooms[room_id] = room
        
        # Start game loop immediately as a background task
        room.game_loop_task = asyncio.create_task(game_loop(room))
        
        return {"room_id": room_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

import random

@app.get("/api/rooms")
async def get_rooms(db: AsyncSession = Depends(get_db)):
    try:
        query = select(DBRoom).where(DBRoom.is_private == False, DBRoom.status == "WAITING")
        result = await db.execute(query)
        rooms_db = result.scalars().all()
        
        rooms_list = []
        for r in rooms_db:
            p1 = await db.get(User, r.player1_id)
            p1_nickname = p1.nickname if p1 else "Unknown"
            rooms_list.append({
                "room_id": r.room_id,
                "room_name": r.room_name,
                "player1_nickname": p1_nickname
            })
        return rooms_list
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/rooms/invite/{invite_code}")
async def get_room_by_invite(invite_code: str, db: AsyncSession = Depends(get_db)):
    try:
        query = select(DBRoom).where(DBRoom.invite_code == invite_code)
        result = await db.execute(query)
        room = result.scalars().first()
        
        if not room:
            raise HTTPException(status_code=404, detail="Private room not found")
        if room.status != "WAITING":
            raise HTTPException(status_code=400, detail="Room is already full or finished")
            
        return {
            "room_id": room.room_id,
            "room_name": room.room_name,
            "status": room.status
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/leaderboard")
async def get_leaderboard(db: AsyncSession = Depends(get_db)):
    try:
        query = select(User).order_by(User.max_survival_ms.desc()).limit(10)
        result = await db.execute(query)
        users = result.scalars().all()
        return [
            {
                "nickname": u.nickname,
                "wins": u.wins,
                "max_survival_ms": u.max_survival_ms
            }
            for u in users
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rooms/{room_id}/join")
async def join_room(room_id: str, data: RoomJoin, db: AsyncSession = Depends(get_db)):
    try:
        # Check if user exists
        user = await db.get(User, data.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
            
        # Check room status
        room_db = await db.get(DBRoom, room_id)
        if not room_db:
            raise HTTPException(status_code=404, detail="Room not found")
        if room_db.status != "WAITING":
            raise HTTPException(status_code=400, detail="Room is already full or finished")
            
        # Prevent joining own room
        if room_db.player1_id == data.user_id:
            raise HTTPException(status_code=400, detail="Cannot join your own room as Player 2")

        # Update room in DB
        room_db.player2_id = data.user_id
        room_db.status = "PLAYING"
        await db.commit()
        
        # Sync in-memory GameRoom
        room = await get_or_reconstruct_room(room_id)
        if room:
            room.player2_id = data.user_id
            room.p2_nickname = user.nickname
            room.status = "PLAYING"
            
            # Start game loop as background task
            if room.game_loop_task is None or room.game_loop_task.done():
                room.game_loop_task = asyncio.create_task(game_loop(room))
                
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# WebSocket Endpoint

# NOTE for deployment: ALB must have sticky sessions (session persistence) enabled
# for WebSocket connections, or use a shared pub/sub backend (e.g. Redis) to relay
# messages across web server instances. Without this, a client connected to web1
# cannot receive broadcasts from a game loop running on web2.
@app.websocket("/ws/{room_id}/{player_slot}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, player_slot: str):
    await websocket.accept()
    
    room = await get_or_reconstruct_room(room_id)
    if not room or room.status == "FINISHED":
        await websocket.close(code=1008, reason="Room not found or finished")
        return
        
    # Assign websocket slot
    if player_slot == "p1":
        room.p1_ws = websocket
    elif player_slot == "p2":
        room.p2_ws = websocket
    else:
        await websocket.close(code=1008, reason="Invalid player slot")
        return
        
    try:
        while True:
            # Handle incoming WebSocket messages
            data = await websocket.receive_json()
            if data.get("type") == "jump":
                if player_slot == "p1":
                    room.p1_ball.jump()
                elif player_slot == "p2":
                    room.p2_ball.jump()
            elif data.get("type") == "chat":
                msg = data.get("msg", "")
                sender = room.p1_nickname if player_slot == "p1" else room.p2_nickname
                await room.broadcast({
                    "type": "chat",
                    "from": player_slot,
                    "msg": msg
                })
            elif data.get("type") == "rematch":
                if room.status == "FINISHED":
                    if player_slot == "p1":
                        room.p1_rematch = True
                    elif player_slot == "p2":
                        room.p2_rematch = True
                    
                    # Broadcast rematch state
                    await room.broadcast({
                        "type": "rematch_status",
                        "p1": room.p1_rematch,
                        "p2": room.p2_rematch
                    })
                    
                    can_start = (room.p1_rematch and room.p2_rematch) or (room.player2_id == -1 and room.p1_rematch)
                    if can_start:
                        async with AsyncSessionLocal() as session:
                            try:
                                room_db = await session.get(DBRoom, room_id)
                                if room_db:
                                    room_db.status = "PLAYING"
                                    await session.commit()
                            except Exception as db_err:
                                await session.rollback()
                                print(f"Error resetting room status in DB for rematch: {db_err}")
                        
                        room.reset_room()
                        active_rooms[room_id] = room
                        
                        await room.broadcast({ "type": "rematch_start" })
                        
                        if room.game_loop_task is None or room.game_loop_task.done():
                            room.game_loop_task = asyncio.create_task(game_loop(room))
    except WebSocketDisconnect:
        # Handle player disconnection
        if room.status == "WAITING":
            # If host (P1) disconnects before game starts, delete room from DB and memory
            if player_slot == "p1":
                async with AsyncSessionLocal() as session:
                    try:
                        await session.execute(
                            delete(DBRoom).where(DBRoom.room_id == room_id)
                        )
                        await session.commit()
                        print(f"Host disconnected from WAITING room {room_id}. Deleted room.")
                    except Exception as e:
                        await session.rollback()
                        print(f"Error deleting WAITING room on host disconnect: {e}")
                if room_id in active_rooms:
                    del active_rooms[room_id]
            else:
                room.p2_ws = None
                
        elif room.status == "PLAYING":
            # Mid-game disconnect: disconnected player immediately loses
            # Determine survivor slot to declare winner
            winner_slot = "p2" if player_slot == "p1" else "p1"
            print(f"Player {player_slot} disconnected from PLAYING room {room_id}. Winner is {winner_slot}.")
            
            # Remove WebSocket pointers to avoid trying to send game_over message to disconnected socket
            if player_slot == "p1":
                room.p1_ws = None
            else:
                room.p2_ws = None
                
            # Trigger end game processing
            await room.end_game(winner_slot)
            
            # Clean up from memory registry
            if room_id in active_rooms:
                del active_rooms[room_id]
    finally:
        # Clean up WebSocket pointer
        if player_slot == "p1":
            room.p1_ws = None
        elif player_slot == "p2":
            room.p2_ws = None
            
        # Clean up from registry if both disconnected and room is finished
        if room.status == "FINISHED" and room.p1_ws is None and room.p2_ws is None:
            if room_id in active_rooms:
                del active_rooms[room_id]
                
# Serve Frontend files
@app.get("/")
async def read_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

@app.get("/game.html")
@app.get("/game")
async def read_game():
    return FileResponse(os.path.join(FRONTEND_DIR, "game.html"))

# Mount the static directory
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
