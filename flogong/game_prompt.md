Act as an expert full-stack software engineer. Build a real-time 2-player multiplayer survival game inspired by Flappy Bird, with physical knockback and player-to-player collision mechanics.

---

### Technology Stack
- **Backend**: Python 3.11+, FastAPI, WebSockets (native `fastapi.websockets`), asyncio
- **Database**: MySQL with `aiomysql` + `SQLAlchemy` (async) or `Tortoise-ORM`
- **Frontend**: Vanilla JavaScript (ES6+), HTML5 Canvas, HTML/CSS overlay for UI

---

### Cloud Deployment Constraints (NCP / Load Balancer ready)
This project will be deployed to a cloud environment (Naver Cloud Platform) with the following infrastructure: 2 web servers behind an Application Load Balancer (ALB), a separate Cloud DB for MySQL instance on a private subnet, and HTTPS/WSS via SSL certificate on the ALB. Write all code to be compatible with this setup from the start.

**① Environment Variables — never hardcode connection info**

All configurable values must be read from environment variables with sensible local defaults:
```python
# backend/config.py
import os

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", 3306))
DB_USER = os.getenv("DB_USER", "root")
DB_PASS = os.getenv("DB_PASS", "password")
DB_NAME = os.getenv("DB_NAME", "flappygame")
```
Generate a `.env.example` file listing all required variables. The app must start cleanly by copying `.env.example` to `.env` and filling in values — no hardcoded IPs or credentials anywhere in source code.

**② WebSocket URL — auto-detect protocol (ws / wss)**

The frontend must never hardcode `ws://` or `wss://`. Detect the current page protocol and upgrade accordingly so the same code works both locally and under HTTPS:
```javascript
// game.js
const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${wsProtocol}//${location.host}/ws/${roomId}/${slot}`);
```

**③ Static resource paths — relative only**

All `<script src="">`, `<link href="">`, `<img src="">`, `fetch()` calls, and `WebSocket` URLs must use relative paths (e.g. `/static/style.css`, `/api/rooms`). Never prefix with `http://` or `https://`. This prevents Mixed Content warnings when the ALB terminates SSL.

**④ Stateless backend — no in-process session storage**

Because the ALB may route requests to either web server (web1 or web2), the backend must not store any game state or session data in Python process memory alone. Use one of:
- **Option A (recommended for this project)**: Store all active room state in the MySQL DB. On each tick, read/write room state from DB. (Simpler, no extra infra needed.)
- **Option B**: Use a shared Redis instance for room state (requires additional infra setup).

Implement Option A. The `game_manager.py` in-memory `GameRoom` objects are fine during an active game loop, but the authoritative source of room status and player assignment must always be persisted to MySQL so either server can reconstruct state on reconnect.

**⑤ WebSocket sticky session note (infrastructure comment)**

Add a comment in `main.py` at the WebSocket endpoint:
```python
# NOTE for deployment: ALB must have sticky sessions (session persistence) enabled
# for WebSocket connections, or use a shared pub/sub backend (e.g. Redis) to relay
# messages across web server instances. Without this, a client connected to web1
# cannot receive broadcasts from a game loop running on web2.
```
This is an infra-level setting, not a code change, but document it clearly.

---

### File Structure
```
project/
├── backend/
│   ├── main.py          # FastAPI app, HTTP + WebSocket endpoints
│   ├── database.py      # Async MySQL engine, session factory
│   ├── models.py        # SQLAlchemy ORM models
│   ├── game_manager.py  # Room registry, game loop logic
│   └── physics.py       # Ball physics, collision calculations
└── frontend/
    ├── index.html       # Lobby screen
    ├── game.html        # Game canvas screen
    ├── style.css
    └── game.js          # WebSocket client, Canvas rendering loop
```

---

### Database Schema

**users**
| Column | Type | Note |
|---|---|---|
| id | INT, PK, AUTO_INCREMENT | |
| nickname | VARCHAR(30), UNIQUE | |
| wins | INT DEFAULT 0 | |
| max_survival_ms | BIGINT DEFAULT 0 | milliseconds |

**game_rooms**
| Column | Type | Note |
|---|---|---|
| room_id | VARCHAR(36), PK | UUID |
| room_name | VARCHAR(50) | |
| player1_id | INT, FK → users.id | |
| player2_id | INT, FK → users.id, NULLABLE | |
| status | ENUM('WAITING','PLAYING','FINISHED') | |
| is_private | BOOLEAN DEFAULT FALSE | if TRUE, excluded from public room list |
| invite_code | VARCHAR(6), NULLABLE, UNIQUE | 6-char alphanumeric, only generated when is_private=TRUE |
| created_at | DATETIME | |

> `game_state` column is intentionally omitted. Game state (ball positions, walls, physics) lives only in server memory during the match. DB is only written once at game end.

**match_results**
| Column | Type | Note |
|---|---|---|
| id | INT, PK, AUTO_INCREMENT | |
| room_id | VARCHAR(36) | |
| winner_id | INT, FK → users.id | |
| loser_id | INT, FK → users.id | |
| winner_survival_ms | BIGINT | |
| played_at | DATETIME | |

---

### Physics Constants (use these exact values)
```python
GRAVITY = 1800          # px/s² downward acceleration
JUMP_VELOCITY = -600    # px/s upward on spacebar/click
BALL_RADIUS = 20        # px
SCROLL_SPEED = 180      # px/s — base speed walls move left
KNOCKBACK_X = -400      # px/s applied to ball on wall hit (leftward)
KNOCKBACK_Y_RANGE = (-150, 150)  # random vertical component on wall hit
DEATH_X = BALL_RADIUS   # ball center X ≤ this → player dies
CANVAS_W, CANVAS_H = 960, 540
FLOOR_Y = CANVAS_H - 40
CEIL_Y = 40
TICK_RATE = 60          # server game loop Hz

# Initial spawn positions
P1_START = (200, 200)   # (x, y)
P2_START = (250, 340)   # offset X to avoid instant collision at game start
```

---

### Wall (Obstacle) Spawn Rules
- Walls are vertical pipes with a gap. Spawn a new wall every **2.0 seconds** (decrease by 0.1s every 15s of gameplay, min 0.8s).
- Gap height starts at **200px**, shrinks by 5px every 15s (min 120px).
- Gap center Y is randomized between `CEIL_Y + gap/2` and `FLOOR_Y - gap/2`.
- Each wall has: `{ x: float, gap_center_y: float, gap_height: float, width: 40 }`.

---

### Core Game Mechanics

**Ball Movement**
- Each ball has state: `{ x, y, vx, vy, alive: bool }`.
- Ball auto-moves rightward at `SCROLL_SPEED` relative to map — implement by keeping ball X roughly fixed and moving walls leftward instead.
- Gravity applies every tick: `vy += GRAVITY * dt`.
- Ball Y is clamped to `[CEIL_Y + BALL_RADIUS, FLOOR_Y - BALL_RADIUS]`.

**Jumping**
- Spacebar (desktop) or tap (mobile): set `vy = JUMP_VELOCITY` (not additive, always override).

**Wall Collision → Knockback**
- On overlap with wall body: apply `vx = KNOCKBACK_X`, `vy = random in KNOCKBACK_Y_RANGE`.
- Do NOT kill the player — they survive until pushed past `DEATH_X`.

**Player-to-Player Collision**
- Circle-circle detection: if `distance(p1, p2) < 2 * BALL_RADIUS`, resolve elastic collision.
- Swap velocity components along the collision normal vector.

**Death Condition**
- `ball.x - BALL_RADIUS ≤ 0` → that player is eliminated.
- Surviving player wins. Broadcast `{ type: "game_over", winner: "p1"|"p2" }`.

---

### Backend Architecture

**game_manager.py — Authoritative Server-Side Game Loop**
```python
# Each active GameRoom runs ONE asyncio task:
async def game_loop(room: GameRoom):
    last_time = asyncio.get_event_loop().time()
    while room.status == "PLAYING":
        now = asyncio.get_event_loop().time()
        dt = now - last_time
        last_time = now
        
        room.update_physics(dt)   # physics.py
        room.check_collisions()
        room.maybe_spawn_wall()
        
        state = room.serialize_state()
        await room.broadcast({ "type": "state", "data": state })
        
        if room.check_death():
            await room.end_game()
            break
        
        await asyncio.sleep(1 / TICK_RATE)
```

**WebSocket Endpoint Structure**
- Use a **single WebSocket per player per room** for both game input and chat:
  ```
  WS /ws/{room_id}/{player_slot}   # player_slot: "p1" or "p2"
  ```
- Incoming message types from client: `{ "type": "jump" }`, `{ "type": "chat", "msg": "..." }`
- Outgoing message types from server:
  - `{ "type": "state", "data": { p1: {x,y}, p2: {x,y}, walls: [...], scores: {...} } }`
  - `{ "type": "chat", "from": "p1", "msg": "..." }`
  - `{ "type": "game_over", "winner": "p1", "survival_ms": 12345 }`
  - `{ "type": "player_joined", "slot": "p2" }` — notify when room fills up

**HTTP Endpoints**
- `POST /users` — create/find user by nickname, return `{ user_id, nickname }`
- `POST /rooms` — create room; request body: `{ room_name, is_private: bool }`
  - if `is_private=true`: generate a random 6-char alphanumeric `invite_code`, store it, return `{ room_id, invite_code }`
  - if `is_private=false`: `invite_code` is null, return `{ room_id }`
  - invite_code generation: use `secrets.token_urlsafe` or `random.choices(string.ascii_uppercase + string.digits, k=6)`, retry on collision
- `GET /rooms` — list only public rooms (`is_private=FALSE`) with `status=WAITING`
- `GET /rooms/invite/{invite_code}` — look up a private room by invite code; return `{ room_id, room_name, status }` or 404 if not found / already PLAYING
- `GET /leaderboard` — top 10 by `max_survival_ms` DESC
- `POST /rooms/{room_id}/join` — assign player2, update status to PLAYING, then trigger `game_loop` as asyncio background task

**DB Write Policy — end of match only**
Game state (ball positions, wall list, velocities) is kept entirely in the `GameRoom` object in server memory. There are NO periodic DB writes during gameplay.

DB is written exactly once when `end_game()` is called:
1. INSERT into `match_results`
2. UPDATE winner's `wins += 1`
3. UPDATE winner's `max_survival_ms` if new record is higher (use `MAX()` comparison)
4. UPDATE `game_rooms` SET `status = 'FINISHED'`

---

### Frontend

**Lobby (index.html + game.js)**
- Nickname input → `POST /users` → store `user_id` in sessionStorage
- **Public room list**: poll `GET /rooms` every 2s; show room name + "Join" button for each entry
  - "Join" → `POST /rooms/{id}/join` → redirect to `game.html?room_id=...&slot=p2`
- **Create Room** button: open a modal with two options:
  - "공개방 만들기": `POST /rooms` with `{ is_private: false }` → redirect as `slot=p1`
  - "비공개방 만들기": `POST /rooms` with `{ is_private: true }` → redirect as `slot=p1`; after redirect, show the `invite_code` in a prominent overlay box (e.g. "초대 코드: AB3X7K") with a one-click copy button
- **초대 코드로 입장** section: a text input + "입장" button
  - On submit: `GET /rooms/invite/{code}` → if found and WAITING, `POST /rooms/{room_id}/join` → redirect as `slot=p2`
  - If room not found or already full: show inline error message "유효하지 않은 코드이거나 이미 시작된 방입니다."
- Leaderboard table fetched from `GET /leaderboard` on page load

**Game Canvas (game.html + game.js)**
- On load: open WebSocket to `WS /ws/{room_id}/{slot}`
- Wait for `{ type: "player_joined" }` from both sides before starting render
- **Render loop** (`requestAnimationFrame`): draw walls, balls, score overlay — driven by latest server state snapshot
- Spacebar / click → send `{ "type": "jump" }` over WebSocket
- Chat box: HTML `<div>` absolutely positioned over canvas (CSS z-index), not drawn on Canvas
- On `game_over`: show result overlay (winner/loser + survival time), "Back to Lobby" button

**Canvas Rendering Details**
- Red ball = P1, Blue ball = P2. Draw drop shadow (ctx.shadowBlur) for visibility.
- Walls: draw as green rectangles with a dark border, show gap clearly.
- Survival timer: draw as text top-center of canvas, updated each frame from server state.
- If a ball is dead (`alive: false`), render it as a faded grey circle still visible at x=0 edge.

---

### Error Handling Requirements
- **WebSocket disconnect mid-game**: no reconnection recovery. The disconnected player immediately loses; `end_game()` is called, surviving player is marked as winner, results saved to DB. Do NOT attempt to restore game state from DB.
- **Room with only 1 player disconnects** (before game starts): delete the room row from DB entirely, no match_results write.
- **Simultaneous death** (both balls pass DEATH_X in the same tick): player with larger X (less far left) wins. If X is identical, P1 wins.
- Wrap all DB operations in try/except with proper rollback.
- On server restart: UPDATE all `status='PLAYING'` rooms to `status='FINISHED'` in DB on startup.
