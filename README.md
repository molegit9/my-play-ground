# my-play-ground

개인 토이 프로젝트 모음 저장소입니다.

---

## Projects

### flogong

실시간 2인 멀티플레이어 생존 게임. Flappy Bird에서 영감을 받았으며, 물리 기반 넉백과 플레이어 간 충돌 판정이 구현되어 있습니다.

**기술 스택**

- Backend: Python, FastAPI, WebSocket, asyncio
- Database: SQLite (로컬) / MySQL (배포)
- Frontend: Vanilla JavaScript, HTML5 Canvas

**실행 방법**

1. 저장소 클론 후 `flogong` 폴더로 이동합니다.

```bash
cd flogong
```

2. `.env.example`을 복사해 `.env` 파일을 만들고 값을 채웁니다.

```bash
cp .env.example .env
```

3. 의존성을 설치합니다.

```bash
pip install fastapi uvicorn sqlalchemy aiosqlite websockets python-dotenv
```

4. 서버를 실행합니다.

```bash
uvicorn backend.main:app --reload
```

5. 브라우저에서 `http://localhost:8000` 으로 접속합니다.

**환경 변수**

| 변수 | 설명 | 기본값 |
| --- | --- | --- |
| DB_HOST | 데이터베이스 호스트 | localhost |
| DB_PORT | 데이터베이스 포트 | 3306 |
| DB_USER | 데이터베이스 유저 | root |
| DB_PASS | 데이터베이스 비밀번호 | password |
| DB_NAME | 데이터베이스 이름 | flappygame |
| USE_SQLITE | SQLite 사용 여부 | true |

`USE_SQLITE=true`로 설정하면 별도의 데이터베이스 설치 없이 SQLite로 바로 실행됩니다.

---

## 폴더 구조

```
my-play-ground/
└── flogong/
    ├── backend/
    │   ├── main.py
    │   ├── database.py
    │   ├── models.py
    │   ├── game_manager.py
    │   └── physics.py
    └── frontend/
        ├── index.html
        ├── game.html
        ├── style.css
        └── game.js
```

새 프로젝트는 루트 아래에 폴더를 추가하는 방식으로 관리합니다.
