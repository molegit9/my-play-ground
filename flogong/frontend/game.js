// game.js
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get("room_id");
const slot = urlParams.get("slot"); // "p1" or "p2"
const inviteCode = urlParams.get("code");

// Game State cache
let latestState = null;
let gameStarted = false;
let myNickname = sessionStorage.getItem("nickname") || (slot === "p1" ? "Player 1" : "Player 2");

// Physics bounds (matches backend)
const CANVAS_W = 960;
const CANVAS_H = 540;
const CEIL_Y = 40;
const FLOOR_Y = CANVAS_H - 40;
const BALL_RADIUS = 20;

// Setup invite overlay if private room
if (slot === "p1" && inviteCode) {
    document.getElementById("invite-overlay").style.display = "flex";
    document.getElementById("invite-code-display").textContent = inviteCode;
}

// WebSocket Connection
const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${wsProtocol}//${location.host}/ws/${roomId}/${slot}`);

ws.onopen = () => {
    console.log(`Connected as ${slot} to room ${roomId}`);
};

ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "player_joined") {
        // Player 2 joined (or notify both)
        document.getElementById("status-title").textContent = "게임이 곧 시작됩니다!";
        document.getElementById("status-desc").textContent = "준비하세요! 3초 후 출발합니다.";
        // Keep overlay for countdown, loop will handle hiding it once state starts arriving
    }
    else if (msg.type === "state") {
        latestState = msg.data;
        if (!gameStarted) {
            gameStarted = true;
            document.getElementById("status-overlay").style.display = "none";
        }
    }
    else if (msg.type === "chat") {
        addChatMessage(msg.from, msg.msg);
    }
    else if (msg.type === "game_over") {
        showGameOver(msg.winner, msg.survival_ms);
    }
    else if (msg.type === "rematch_status") {
        const textEl = document.getElementById("rematch-status-text");
        textEl.style.display = "block";
        
        const myRequest = slot === "p1" ? msg.p1 : msg.p2;
        const count = (msg.p1 ? 1 : 0) + (msg.p2 ? 1 : 0);
        
        let p1Name = latestState?.p1_nickname || "P1";
        let p2Name = latestState?.p2_nickname || "P2";
        
        if (latestState && latestState.p2_nickname === "AI 컴퓨터") {
            textEl.textContent = "다시 하기 준비 중...";
        } else {
            let applicants = [];
            if (msg.p1) applicants.push(p1Name);
            if (msg.p2) applicants.push(p2Name);
            textEl.textContent = `다시 하기 대기 중 (${count}/2) - ${applicants.join(", ")} 수락 완료`;
        }
        
        if (myRequest) {
            const btn = document.getElementById("rematch-btn");
            btn.disabled = true;
            btn.textContent = "신청 완료";
            btn.style.opacity = "0.6";
        }
    }
    else if (msg.type === "rematch_start") {
        document.getElementById("game-over-overlay").style.display = "none";
        
        const statusOverlay = document.getElementById("status-overlay");
        statusOverlay.style.display = "flex";
        document.getElementById("status-title").textContent = "다시 시작 중!";
        document.getElementById("status-desc").textContent = "준비하세요! 3초 후 출발합니다.";
        document.getElementById("status-spinner").style.display = "block";
        
        gameStarted = false;
        latestState = null;
        
        const btn = document.getElementById("rematch-btn");
        btn.disabled = false;
        btn.textContent = "다시 하기";
        btn.style.opacity = "1";
        document.getElementById("rematch-status-text").style.display = "none";
    }
};

ws.onclose = (event) => {
    console.log("WebSocket connection closed", event);
    if (!latestState || latestState.status !== "FINISHED") {
        document.getElementById("status-overlay").style.display = "flex";
        document.getElementById("status-title").textContent = "연결이 끊어졌습니다";
        document.getElementById("status-desc").innerHTML = '서버와의 연결이 중단되었습니다.<br><button class="btn-primary" onclick="goToLobby()" style="margin-top: 1rem;">로비로 돌아가기</button>';
        document.getElementById("status-spinner").style.display = "none";
    }
};

ws.onerror = (error) => {
    console.error("WebSocket error", error);
};

// Input Handling
window.addEventListener("keydown", (e) => {
    // Ignore space jump if chatting
    if (document.activeElement === document.getElementById("chat-input")) {
        return;
    }
    
    if (e.code === "Space") {
        e.preventDefault();
        sendJump();
    }
});

canvas.addEventListener("click", () => {
    sendJump();
});

canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    sendJump();
});

function sendJump() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "jump" }));
    }
}

// Chat Overlay Logic
function sendChatMessage(e) {
    e.preventDefault();
    const input = document.getElementById("chat-input");
    const msg = input.value.trim();
    if (!msg) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat", msg: msg }));
        addChatMessage("self", msg);
        input.value = "";
    }
}

function addChatMessage(sender, msg) {
    const container = document.getElementById("chat-messages");
    const msgEl = document.createElement("div");
    
    if (sender === "self") {
        msgEl.className = "chat-message self";
        msgEl.textContent = msg;
    } else {
        msgEl.className = `chat-message ${sender}`;
        const name = sender === "p1" ? (latestState?.p1_nickname || "P1") : (latestState?.p2_nickname || "P2");
        msgEl.textContent = `${name}: ${msg}`;
    }

    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
}

// Result Panel
function showGameOver(winnerSlot, survivalMs) {
    document.getElementById("game-over-overlay").style.display = "flex";
    
    const isWinner = winnerSlot === slot;
    const titleEl = document.getElementById("game-over-title");
    const resultEl = document.getElementById("game-over-result");
    const timeEl = document.getElementById("game-over-time");

    if (isWinner) {
        titleEl.textContent = "VICTORY! 🎉";
        titleEl.style.color = "#10b981"; // green
        resultEl.textContent = "상대방을 꺾고 승리하였습니다!";
    } else {
        titleEl.textContent = "DEFEAT... 😢";
        titleEl.style.color = "#ef4444"; // red
        resultEl.textContent = "서바이벌 매치에서 패배하였습니다.";
    }

    timeEl.textContent = `생존 기록: ${(survivalMs / 1000).toFixed(2)}초`;
}

function copyInviteCode() {
    const text = document.getElementById("invite-code-display").textContent;
    navigator.clipboard.writeText(text).then(() => {
        alert("초대 코드가 복사되었습니다: " + text);
    }).catch(err => {
        console.error("복사 실패", err);
    });
}

function goToLobby() {
    window.location.href = "/";
}

function requestRematch() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "rematch" }));
    }
}

// Canvas Rendering Loop
function render() {
    requestAnimationFrame(render);
    
    // Clear canvas
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Draw Background
    drawGridBackground();

    // Draw Boundaries (Ceiling & Floor)
    drawBoundaries();

    if (!latestState) return;

    // Draw Walls
    drawWalls(latestState.walls);

    // Draw Balls (P1 and P2)
    drawPlayerBall(latestState.p1, "p1", latestState.p1_nickname);
    drawPlayerBall(latestState.p2, "p2", latestState.p2_nickname);

    // Draw HUD Scores & Survival Status
    drawHUD();
}

function drawGridBackground() {
    // Gradient sky
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, "#080c14");
    grad.addColorStop(1, "#111827");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid scrolling offset
    // Offset is based on survival time if game is active, else static
    let elapsedSeconds = 0;
    if (latestState) {
        elapsedSeconds = Math.max(latestState.scores.p1, latestState.scores.p2) / 1000;
    }
    const scrollSpeed = 180; // px/s
    const gridSpacing = 60;
    const bgOffset = (elapsedSeconds * scrollSpeed) % gridSpacing;

    ctx.strokeStyle = "rgba(14, 165, 233, 0.05)";
    ctx.lineWidth = 1;

    // Vertical lines
    for (let x = -bgOffset; x < CANVAS_W; x += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, CEIL_Y);
        ctx.lineTo(x, FLOOR_Y);
        ctx.stroke();
    }

    // Horizontal lines (no scroll)
    for (let y = CEIL_Y; y <= FLOOR_Y; y += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_W, y);
        ctx.stroke();
    }
}

function drawBoundaries() {
    ctx.lineWidth = 3;
    
    // Ceiling
    ctx.strokeStyle = "rgba(139, 92, 246, 0.3)";
    ctx.beginPath();
    ctx.moveTo(0, CEIL_Y);
    ctx.lineTo(CANVAS_W, CEIL_Y);
    ctx.stroke();
    
    // Floor
    ctx.strokeStyle = "rgba(139, 92, 246, 0.5)";
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    ctx.lineTo(CANVAS_W, FLOOR_Y);
    ctx.stroke();

    // Fill ceiling & floor caps
    ctx.fillStyle = "#070a10";
    ctx.fillRect(0, 0, CANVAS_W, CEIL_Y);
    ctx.fillRect(0, FLOOR_Y, CANVAS_W, CANVAS_H - FLOOR_Y);
}

function drawWalls(walls) {
    walls.forEach(wall => {
        const topPipeH = wall.gap_center_y - wall.gap_height / 2;
        const bottomPipeY = wall.gap_center_y + wall.gap_height / 2;
        
        ctx.fillStyle = "#059669"; // Green fill
        ctx.strokeStyle = "#022c22"; // Dark border
        ctx.lineWidth = 3;

        // Top Pipe
        ctx.beginPath();
        ctx.rect(wall.x, CEIL_Y, wall.width, top_pipe_height_clamp(topPipeH));
        ctx.fill();
        ctx.stroke();

        // Bottom Pipe
        ctx.beginPath();
        ctx.rect(wall.x, bottomPipeY, wall.width, FLOOR_Y - bottomPipeY);
        ctx.fill();
        ctx.stroke();

        // Lip accents for pipes
        ctx.fillStyle = "#10b981";
        // Top lip
        const lipH = 15;
        const lipW = wall.width + 8;
        ctx.beginPath();
        ctx.rect(wall.x - 4, topPipeH - lipH, lipW, lipH);
        ctx.fill();
        ctx.stroke();
        // Bottom lip
        ctx.beginPath();
        ctx.rect(wall.x - 4, bottomPipeY, lipW, lipH);
        ctx.fill();
        ctx.stroke();

        // Draw instant-death kill zone warning overlay
        if (wall.kill_zone) {
            const kz = wall.kill_zone;
            const kzH = kz.y_end - kz.y_start;

            ctx.save();
            // Solid bright warning red
            ctx.fillStyle = "#ef4444";
            ctx.beginPath();
            ctx.rect(wall.x, kz.y_start, wall.width, kzH);
            ctx.fill();

            // Dark red outline
            ctx.strokeStyle = "#991b1b";
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // Hazard warning stripes
            ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.rect(wall.x, kz.y_start, wall.width, kzH);
            ctx.clip();

            for (let offset = -kzH; offset < wall.width + kzH; offset += 12) {
                ctx.beginPath();
                ctx.moveTo(wall.x + offset, kz.y_start);
                ctx.lineTo(wall.x + offset + kzH, kz.y_end);
                ctx.stroke();
            }
            ctx.restore();
        }
    });
}

function top_pipe_height_clamp(h) {
    return Math.max(0, h - CEIL_Y);
}

function drawPlayerBall(ball, playerSlot, nickname) {
    ctx.save();
    
    let color, glowColor;
    if (!ball.alive) {
        color = "#64748b"; // slate-500 (faded grey)
        glowColor = "rgba(100, 116, 139, 0)";
    } else if (playerSlot === "p1") {
        color = "#ef4444"; // P1 Red
        glowColor = "rgba(239, 68, 68, 0.6)";
    } else {
        color = "#3b82f6"; // P2 Blue
        glowColor = "rgba(59, 130, 246, 0.6)";
    }

    // Shadow & glow
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = ball.alive ? 15 : 0;
    
    // Draw ball
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    ctx.restore();

    // Draw nickname above ball
    ctx.fillStyle = ball.alive ? "#f8fafc" : "#94a3b8";
    ctx.font = "bold 13px 'Outfit', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(nickname || playerSlot.toUpperCase(), ball.x, ball.y - 28);

    // Indicator if this ball is me
    if (playerSlot === slot && ball.alive) {
        ctx.fillStyle = "#fbbf24"; // yellow indicator
        ctx.beginPath();
        ctx.moveTo(ball.x - 6, ball.y - 45);
        ctx.lineTo(ball.x + 6, ball.y - 45);
        ctx.lineTo(ball.x, ball.y - 37);
        ctx.closePath();
        ctx.fill();
    }
}

function drawHUD() {
    if (!latestState) return;

    const p1Survival = latestState.scores.p1;
    const p2Survival = latestState.scores.p2;

    // Survival timer in center top
    const timerText = `${(Math.max(p1Survival, p2Survival) / 1000).toFixed(2)}s`;
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 24px 'Outfit', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(timerText, CANVAS_W / 2, 28);

    // Draw indicators for Player 1 / Player 2 status on left/right top
    ctx.font = "bold 14px 'Outfit', sans-serif";
    
    // P1 status (Red)
    ctx.fillStyle = latestState.p1.alive ? "#ef4444" : "#64748b";
    ctx.textAlign = "left";
    ctx.fillText(`P1: ${escapeHtml(latestState.p1_nickname)} (${(p1Survival / 1000).toFixed(2)}s)`, 20, 26);

    // P2 status (Blue)
    ctx.fillStyle = latestState.p2.alive ? "#3b82f6" : "#64748b";
    ctx.textAlign = "right";
    ctx.fillText(`P2: ${escapeHtml(latestState.p2_nickname)} (${(p2Survival / 1000).toFixed(2)}s)`, CANVAS_W - 20, 26);
}

function escapeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Start drawing
render();
