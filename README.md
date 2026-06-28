# my-play-ground

개인 토이 프로젝트 모음 저장소입니다.

---

## Projects

### 🎮 flogong

실시간 2인 멀티플레이어 생존 게임. Flappy Bird에서 영감을 받았으며, 물리 기반 넉백과 플레이어 간 충돌 판정이 구현되어 있습니다.

**기술 스택**

- **Backend:** Python, FastAPI, WebSocket, asyncio
- **Database:** SQLite (로컬) / MySQL (배포)
- **Frontend:** Vanilla JavaScript, HTML5 Canvas

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

---

### 🎨 co-whiteboard

웹소켓을 통한 실시간 마우스/드로잉 동기화와 EasyOCR 기반의 이미지 텍스트 추출(OCR) 기능을 제공하는 다인 협업 화이트보드 애플리케이션입니다.

**기술 스택**

- **Backend:** Python, FastAPI, WebSockets, EasyOCR, PyTorch (CPU), Redis, python-dotenv
- **Frontend:** React (Vite), HTML5 Canvas, Vanilla CSS

**실행 방법**

#### 1. 백엔드(Backend) 실행
1. `co-whiteboard/backend` 폴더로 이동합니다.
   ```bash
   cd co-whiteboard/backend
   ```
2. `.env.example`을 복사하여 `.env` 파일을 생성하고 필요에 따라 설정을 조정합니다 (기본값으로 동작 가능).
   ```bash
   cp .env.example .env
   ```
3. 의존성을 설치합니다 (EasyOCR 및 PyTorch CPU 버전이 설치됩니다).
   ```bash
   pip install -r requirements.txt
   ```
4. Redis 서버를 실행합니다 (로컬 포트 6379 기본값).
5. 백엔드 서버를 구동합니다.
   ```bash
   uvicorn main:app --reload --port 8000
   ```

#### 2. 프론트엔드(Frontend) 실행
1. `co-whiteboard/frontend` 폴더로 이동합니다.
   ```bash
   cd co-whiteboard/frontend
   ```
2. 의존성 패키지를 설치합니다.
   ```bash
   npm install
   ```
3. 개발용 서버를 실행합니다.
   ```bash
   npm run dev
   ```
4. 브라우저로 `http://localhost:5173`에 접속합니다.

---

### 🔍 phishing-scanner-web

Google Gemini API와 RAG(Retrieval-Augmented Generation) 패턴을 연동하고, Playwright를 활용해 실제 웹사이트를 실시간으로 스크래핑/렌더링하여 피싱(스미싱/사기) 웹사이트 여부를 심층 진단하는 위협 분석 플랫폼입니다.

**기술 스택**

- **Backend:** Python, FastAPI, Google GenAI SDK (Gemini), Playwright, BeautifulSoup4, ChromaDB, Sentence-Transformers, SQLite, pandas
- **Frontend:** HTML5, Vanilla CSS, Vanilla JavaScript

**실행 방법**

#### 🚀 Windows 간편 실행 (배치 파일 이용)
Windows 환경의 경우 `phishing-scanner-web/run.bat` 스크립트를 통해 원클릭으로 구동할 수 있습니다.
1. `phishing-scanner-web/.env` 파일을 생성하고 필요한 API Key를 채웁니다.
   ```env
   GEMINI_API_KEY="본인의_GEMINI_API_KEY"
   VIRUSTOTAL_API_KEY="본인의_VIRUSTOTAL_API_KEY" # 선택사항
   DATABASE_URL="sqlite:///./security_logs.db"
   RAG_DATASET_PATH="./data/merged_security_dataset.csv"
   RAG_DATASET_PATHS='["./data/merged_security_dataset.csv", "./data/phishing_dataset.csv"]'
   CHROMA_DB_PATH="./chroma_db"
   ```
2. `phishing-scanner-web` 디렉토리로 이동한 뒤 `run.bat` 파일을 실행합니다.
   ```cmd
   run.bat
   ```
   *(이 배치 파일은 의존성 설치, Playwright 브라우저 바이너리 다운로드 및 uvicorn 서버 구동을 모두 수행합니다)*

#### 🛠️ 수동 실행 방법
1. `phishing-scanner-web` 폴더로 이동합니다.
   ```bash
   cd phishing-scanner-web
   ```
2. `.env` 파일을 설정합니다.
3. 의존성 라이브러리를 설치합니다.
   ```bash
   pip install -r requirements.txt
   ```
4. Playwright에 필요한 브라우저 엔진을 설치합니다.
   ```bash
   python -m playwright install chromium firefox
   ```
5. 서버를 실행합니다.
   ```bash
   python -m uvicorn app.main:app --port 8002 --reload
   ```
6. 브라우저에서 `http://localhost:8002` 로 접속합니다.

---

## 폴더 구조

```text
my-play-ground/
├── co-whiteboard/            # 실시간 협업 화이트보드
│   ├── backend/              # FastAPI, EasyOCR, WebSockets
│   └── frontend/             # React + Vite
├── flogong/                  # 실시간 2인 멀티플레이어 생존 게임
│   ├── backend/              # FastAPI, WebSockets
│   └── frontend/             # HTML Canvas, Vanilla JS
└── phishing-scanner-web/     # AI 기반 피싱 탐지 웹 서비스
    ├── app/                  # FastAPI & RAG / Gemini 분석 엔진
    ├── data/                 # RAG용 보안 데이터셋
    ├── frontend/             # Vanilla UI (HTML, CSS, JS)
    └── run.bat               # Windows 간편 실행 스크립트
```

새 프로젝트는 루트 아래에 폴더를 추가하는 방식으로 관리합니다.
