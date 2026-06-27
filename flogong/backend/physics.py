import random
import math

# Physics Constants
GRAVITY = 1800
JUMP_VY = -600
JUMP_VX_BOOST = 50
BALL_RADIUS = 20
SCROLL_SPEED_BASE = 180     # 기본 벽 속도
SCROLL_SPEED_MAX = 340      # 최대 벽 속도 (선두가 독주할 때 상한)
KNOCKBACK_X = -500
KNOCKBACK_Y_RANGE = (-150, 150)
DEATH_X = BALL_RADIUS
CANVAS_W, CANVAS_H = 960, 540
FLOOR_Y = CANVAS_H - 40
CEIL_Y = 40
TICK_RATE = 60
FRICTION = 0.94
MAX_VX = 300.0

KILL_ZONE_SIZE = 30         # 즉사 구역 높이 (px)
KILL_ZONE_CHANCE = 0.5      # 벽 생성 시 즉사 구역 붙을 확률

P1_START = (200.0, 200.0)
P2_START = (200.0, 340.0)


class Ball:
    def __init__(self, start_x: float, start_y: float):
        self.x = float(start_x)
        self.y = float(start_y)
        self.vx = 0.0
        self.vy = 0.0
        self.alive = True

    def jump(self):
        if self.alive:
            self.vy = JUMP_VY
            self.vx += JUMP_VX_BOOST
            if self.vx > MAX_VX:
                self.vx = MAX_VX

    def update_physics(self, dt: float):
        if not self.alive:
            self.x = 0.0
            self.vx = 0.0
            self.vy = 0.0
            return

        self.vy += GRAVITY * dt
        self.vx *= FRICTION
        self.x += self.vx * dt
        self.y += self.vy * dt

        # X 클램핑
        max_x = CANVAS_W - BALL_RADIUS
        if self.x > max_x:
            self.x = max_x
            self.vx = 0.0

        # Y 클램핑
        min_y = CEIL_Y + BALL_RADIUS
        max_y = FLOOR_Y - BALL_RADIUS
        if self.y < min_y:
            self.y = min_y
            self.vy = -self.vy * 0.5
        elif self.y > max_y:
            self.y = max_y
            self.vy = -self.vy * 0.5
            if abs(self.vy) < 80.0:
                self.vy = 0.0

    def check_death(self) -> bool:
        if self.alive and (self.x - BALL_RADIUS <= 0.0):
            self.alive = False
            self.x = 0.0
            self.vx = 0.0
            self.vy = 0.0
            return True
        return not self.alive

    def serialize(self):
        return {
            "x": self.x,
            "y": self.y,
            "vx": self.vx,
            "vy": self.vy,
            "alive": self.alive
        }


def get_dynamic_scroll_speed(p1: Ball, p2: Ball) -> float:
    """
    선두 공의 X가 앞서있을수록 벽 속도를 높임.
    두 공의 X 차이를 기준으로 선형 보간.
    차이 0px   → SCROLL_SPEED_BASE (180)
    차이 200px → SCROLL_SPEED_MAX  (340)
    차이 그 이상 → SCROLL_SPEED_MAX 고정
    """
    if not p1.alive and not p2.alive:
        return SCROLL_SPEED_BASE
    if not p1.alive:
        lead_x = p2.x
        trail_x = 0.0
    elif not p2.alive:
        lead_x = p1.x
        trail_x = 0.0
    else:
        lead_x = max(p1.x, p2.x)
        trail_x = min(p1.x, p2.x)

    gap = max(0.0, lead_x - trail_x)
    t = min(gap / 200.0, 1.0)   # 0~1 정규화
    return SCROLL_SPEED_BASE + t * (SCROLL_SPEED_MAX - SCROLL_SPEED_BASE)


def check_kill_zone(ball: Ball, wall: dict) -> bool:
    """
    벽의 즉사 구역(kill_zone)에 공이 닿으면 즉시 사망.
    kill_zone: { pipe: 'top'|'bottom', y_start: float, y_end: float }
    """
    if not ball.alive or "kill_zone" not in wall:
        return False

    kz = wall["kill_zone"]
    wall_x = wall["x"]
    wall_w = wall.get("width", 40.0)

    # 공이 벽 X 범위 안에 있는지
    if not (wall_x - BALL_RADIUS < ball.x < wall_x + wall_w + BALL_RADIUS):
        return False

    # 공이 즉사 구역 Y 범위 안에 있는지
    if kz["y_start"] - BALL_RADIUS < ball.y < kz["y_end"] + BALL_RADIUS:
        ball.alive = False
        ball.vx = 0.0
        ball.vy = 0.0
        return True

    return False


def resolve_rect_collision(ball: Ball, rx: float, ry: float, rw: float, rh: float) -> bool:
    closest_x = max(rx, min(ball.x, rx + rw))
    closest_y = max(ry, min(ball.y, ry + rh))

    dx = ball.x - closest_x
    dy = ball.y - closest_y
    dist = math.sqrt(dx * dx + dy * dy)

    if dist < BALL_RADIUS:
        if dist == 0:
            nx, ny = 0.0, -1.0
            dist = 0.1
        else:
            nx = dx / dist
            ny = dy / dist

        overlap = BALL_RADIUS - dist
        ball.x += nx * overlap
        ball.y += ny * overlap

        min_y = CEIL_Y + BALL_RADIUS
        max_y = FLOOR_Y - BALL_RADIUS
        ball.y = max(min_y, min(max_y, ball.y))

        if nx < -0.5:
            ball.vx = KNOCKBACK_X
            ball.vy = random.uniform(*KNOCKBACK_Y_RANGE)
        elif ny < -0.5:
            if ball.vy > 0:
                ball.vy = -ball.vy * 0.6
                if ball.vy > -150:
                    ball.vy = -150
        elif ny > 0.5:
            if ball.vy < 0:
                ball.vy = -ball.vy * 0.6
                if ball.vy < 150:
                    ball.vy = 150
        else:
            if nx > 0.5:
                ball.vx = -ball.vx * 0.6
            else:
                ball.vx = KNOCKBACK_X
                ball.vy = random.uniform(*KNOCKBACK_Y_RANGE)
        return True
    return False


def check_wall_collision(ball: Ball, wall: dict) -> bool:
    if not ball.alive:
        return False

    # 즉사 구역 먼저 체크
    if check_kill_zone(ball, wall):
        return True

    wall_x = wall["x"]
    wall_w = wall.get("width", 40.0)
    gap_y = wall["gap_center_y"]
    gap_h = wall["gap_height"]

    top_pipe_h = gap_y - gap_h / 2.0
    bottom_pipe_y = gap_y + gap_h / 2.0
    bottom_pipe_h = CANVAS_H - bottom_pipe_y

    collided = False
    if resolve_rect_collision(ball, wall_x, 0.0, wall_w, top_pipe_h):
        collided = True
    if resolve_rect_collision(ball, wall_x, bottom_pipe_y, wall_w, bottom_pipe_h):
        collided = True

    return collided


def make_wall(x: float, gap_center_y: float, gap_height: float) -> dict:
    """
    벽 생성. KILL_ZONE_CHANCE 확률로 즉사 구역 추가.
    즉사 구역은 갭과 인접한 파이프 엣지에 붙음 (갭 바로 위 또는 바로 아래).
    """
    wall = {
        "x": x,
        "gap_center_y": gap_center_y,
        "gap_height": gap_height,
        "width": 40.0
    }

    if random.random() < KILL_ZONE_CHANCE:
        top_pipe_bottom = gap_center_y - gap_height / 2.0   # 위 파이프 하단
        bottom_pipe_top = gap_center_y + gap_height / 2.0   # 아래 파이프 상단

        if random.random() < 0.5:
            # 위 파이프 하단 엣지에 즉사 구역
            wall["kill_zone"] = {
                "pipe": "top",
                "y_start": top_pipe_bottom - KILL_ZONE_SIZE,
                "y_end": top_pipe_bottom
            }
        else:
            # 아래 파이프 상단 엣지에 즉사 구역
            wall["kill_zone"] = {
                "pipe": "bottom",
                "y_start": bottom_pipe_top,
                "y_end": bottom_pipe_top + KILL_ZONE_SIZE
            }

    return wall


def resolve_player_collision(p1: Ball, p2: Ball):
    if not p1.alive or not p2.alive:
        return

    dx = p2.x - p1.x
    dy = p2.y - p1.y
    dist = math.sqrt(dx * dx + dy * dy)
    min_dist = BALL_RADIUS * 2.0

    if dist < min_dist:
        if dist == 0:
            dx = 1.0
            dy = 0.0
            dist = 1.0

        nx = dx / dist
        ny = dy / dist

        overlap = min_dist - dist
        p1.x -= overlap * 0.5 * nx
        p1.y -= overlap * 0.5 * ny
        p2.x += overlap * 0.5 * nx
        p2.y += overlap * 0.5 * ny

        min_y = CEIL_Y + BALL_RADIUS
        max_y = FLOOR_Y - BALL_RADIUS
        p1.y = max(min_y, min(max_y, p1.y))
        p2.y = max(min_y, min(max_y, p2.y))

        rvx = p2.vx - p1.vx
        rvy = p2.vy - p1.vy
        vel_along_normal = rvx * nx + rvy * ny

        if vel_along_normal < 0:
            v1_n = p1.vx * nx + p1.vy * ny
            v2_n = p2.vx * nx + p2.vy * ny

            e = 1.4
            v1_n_new = (v1_n * (1.0 - e) + (1.0 + e) * v2_n) / 2.0
            v2_n_new = (v2_n * (1.0 - e) + (1.0 + e) * v1_n) / 2.0

            tx = -ny
            ty = nx
            v1_t = p1.vx * tx + p1.vy * ty
            v2_t = p2.vx * tx + p2.vy * ty

            p1.vx = v1_n_new * nx + v1_t * tx
            p1.vy = v1_n_new * ny + v1_t * ty
            p2.vx = v2_n_new * nx + v2_t * tx
            p2.vy = v2_n_new * ny + v2_t * ty
