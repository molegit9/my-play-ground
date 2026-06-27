import asyncio
from datetime import datetime
import random
from backend.physics import Ball, check_wall_collision, resolve_player_collision, P1_START, P2_START, TICK_RATE, CANVAS_W, CANVAS_H, CEIL_Y, FLOOR_Y, get_dynamic_scroll_speed, make_wall
from backend.database import AsyncSessionLocal
from backend.models import User, GameRoom as DBRoom, MatchResult
from sqlalchemy import select, update, delete

class GameRoom:
    def __init__(self, room_id: str, room_name: str, player1_id: int, p1_nickname: str):
        self.room_id = room_id
        self.room_name = room_name
        self.player1_id = player1_id
        self.player2_id = None
        self.p1_nickname = p1_nickname
        self.p2_nickname = ""
        
        self.status = "WAITING"  # WAITING, PLAYING, FINISHED
        self.p1_ws = None
        self.p2_ws = None
        
        self.p1_ball = Ball(*P1_START)
        self.p2_ball = Ball(*P2_START)
        self.walls = []
        
        self.elapsed_time = 0.0
        self.spawn_timer = 0.0
        
        self.p1_survival_ms = 0
        self.p2_survival_ms = 0
        
        self.p1_rematch = False
        self.p2_rematch = False
        
        self.game_loop_task = None

    async def broadcast(self, message: dict):
        tasks = []
        if self.p1_ws:
            tasks.append(self.p1_ws.send_json(message))
        if self.p2_ws:
            tasks.append(self.p2_ws.send_json(message))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def update_physics(self, dt: float):
        self.p1_ball.update_physics(dt)
        self.p2_ball.update_physics(dt)
        
        if self.p1_ball.alive:
            self.p1_survival_ms = int(self.elapsed_time * 1000)
        if self.p2_ball.alive:
            self.p2_survival_ms = int(self.elapsed_time * 1000)

    def check_collisions(self):
        # Wall collisions are fully resolved (bounce/knockback) inside check_wall_collision
        for wall in self.walls:
            check_wall_collision(self.p1_ball, wall)
            check_wall_collision(self.p2_ball, wall)
                
        # Player-to-player collision
        resolve_player_collision(self.p1_ball, self.p2_ball)

    def maybe_spawn_wall(self, dt: float):
        self.elapsed_time += dt
        self.spawn_timer += dt
        
        wall_spawn_interval = max(0.8, 2.0 - 0.1 * int(self.elapsed_time / 15.0))
        gap_height = max(120.0, 200.0 - 5.0 * int(self.elapsed_time / 15.0))
        
        # Dynamic scroll speed based on the lead player
        scroll_speed = get_dynamic_scroll_speed(self.p1_ball, self.p2_ball)
        
        for wall in self.walls:
            wall["x"] -= scroll_speed * dt
            
        self.walls = [w for w in self.walls if w["x"] + 40.0 >= 0.0]
        
        if self.spawn_timer >= wall_spawn_interval:
            self.spawn_timer = 0.0
            gap_center_y = random.uniform(
                CEIL_Y + gap_height / 2.0,
                FLOOR_Y - gap_height / 2.0
            )
            self.walls.append(make_wall(float(CANVAS_W), float(gap_center_y), float(gap_height)))

    def check_death(self) -> bool:
        p1_dead = self.p1_ball.check_death()
        p2_dead = self.p2_ball.check_death()
        return p1_dead or p2_dead

    def get_winner_slot(self) -> str:
        if not self.p1_ball.alive and not self.p2_ball.alive:
            if self.p1_ball.x > self.p2_ball.x:
                return "p1"
            elif self.p2_ball.x > self.p1_ball.x:
                return "p2"
            else:
                return "p1"
        if not self.p1_ball.alive:
            return "p2"
        return "p1"

    def serialize_state(self) -> dict:
        return {
            "p1": self.p1_ball.serialize(),
            "p2": self.p2_ball.serialize(),
            "p1_nickname": self.p1_nickname,
            "p2_nickname": self.p2_nickname,
            "walls": self.walls,
            "scores": {
                "p1": self.p1_survival_ms,
                "p2": self.p2_survival_ms
            }
        }

    async def end_game(self, winner_slot: str):
        if self.status == "FINISHED":
            return
        self.status = "FINISHED"
        
        winner_id = self.player1_id if winner_slot == "p1" else self.player2_id
        loser_id = self.player2_id if winner_slot == "p1" else self.player1_id
        
        winner_survival_ms = self.p1_survival_ms if winner_slot == "p1" else self.p2_survival_ms
        
        # Broadcast game over result
        await self.broadcast({
            "type": "game_over",
            "winner": winner_slot,
            "survival_ms": winner_survival_ms
        })
        
        # Do NOT close WebSockets on game over so players can request rematch
            
        # Write results to DB with try/except and rollback
        async with AsyncSessionLocal() as session:
            try:
                # 1. Insert into match_results
                result = MatchResult(
                    room_id=self.room_id,
                    winner_id=winner_id,
                    loser_id=loser_id,
                    winner_survival_ms=winner_survival_ms,
                    played_at=datetime.utcnow()
                )
                session.add(result)
                
                # 2. Update winner's wins and max_survival_ms
                winner = await session.get(User, winner_id)
                if winner:
                    winner.wins += 1
                    if winner_survival_ms > winner.max_survival_ms:
                        winner.max_survival_ms = winner_survival_ms
                        
                # 3. Update game_rooms status to FINISHED
                room_db = await session.get(DBRoom, self.room_id)
                if room_db:
                    room_db.status = "FINISHED"
                    
                await session.commit()
            except Exception as e:
                await session.rollback()
                print(f"Error saving match results to database: {e}")

    def reset_room(self):
        self.p1_ball = Ball(*P1_START)
        self.p2_ball = Ball(*P2_START)
        self.walls = []
        self.elapsed_time = 0.0
        self.spawn_timer = 0.0
        self.p1_survival_ms = 0
        self.p2_survival_ms = 0
        self.p1_rematch = False
        self.p2_rematch = False
        self.status = "PLAYING"

# Room registry
active_rooms: dict[str, GameRoom] = {}

async def game_loop(room: GameRoom):
    # Wait for necessary websockets to connect (only wait for P1 if P2 is computer)
    while room.status == "PLAYING":
        if room.p1_ws is None:
            await asyncio.sleep(0.1)
            continue
        if room.player2_id != -1 and room.p2_ws is None:
            await asyncio.sleep(0.1)
            continue
        break
        
    if room.status != "PLAYING":
        return
        
    # Notify that players are ready to start
    await room.broadcast({ "type": "player_joined", "slot": "p2" })
    
    # Wait a moment before starting physics
    await asyncio.sleep(1.0)
    
    last_time = asyncio.get_event_loop().time()
    while room.status == "PLAYING":
        now = asyncio.get_event_loop().time()
        dt = now - last_time
        last_time = now
        
        dt = min(dt, 0.1)
        
        # Computer (AI) behavior for Player 2
        if room.player2_id == -1 and room.p2_ball.alive:
            # Find nearest upcoming wall in front of P2 ball
            upcoming = [w for w in room.walls if w["x"] + w["width"] > room.p2_ball.x]
            if upcoming:
                upcoming.sort(key=lambda w: w["x"])
                target_y = upcoming[0]["gap_center_y"]
            else:
                target_y = 270.0  # Center height of canvas
            
            # Simple threshold tracking with reaction noise
            if room.p2_ball.y > target_y + random.uniform(10.0, 22.0):
                room.p2_ball.jump()
        
        room.update_physics(dt)
        room.check_collisions()
        room.maybe_spawn_wall(dt)
        
        state = room.serialize_state()
        await room.broadcast({ "type": "state", "data": state })
        
        if room.check_death():
            winner_slot = room.get_winner_slot()
            await room.end_game(winner_slot)
            break
            
        await asyncio.sleep(1 / TICK_RATE)
