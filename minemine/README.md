# 💣 MINEMINE - Multiplayer Minesweeper Battle Royale

> 실시간으로 대전하는 멀티플레이어 지뢰찾기 배틀로얄 게임입니다. 테트리스 99의 대전 방식에서 영감을 얻어 제작되었으며, 여러 명이 동시에 보드를 풀어가며 속도와 실력을 겨룹니다.

---

## 🚀 Key Features (핵심 기능)

- 🎮 **실시간 멀티플레이어 대전**: 상대방의 플레이 현황이 미니 맵(썸네일 그리드) 형태로 실시간 동기화됩니다.
- ⚡ **레벨 및 스케일 업 시스템**: 보드를 완벽하게 클리어할 때마다 레벨이 오르고, 격자 판이 순차적으로 커지며 난이도가 상승합니다 (9x9 → 12x12 → 16x16 → 20x20 ...).
- 🛡️ **안전한 첫 클릭 (First-Click Safety)**: 어떤 방이든 플레이어가 처음 클릭한 위치와 그 주변 3x3 영역에는 지뢰가 배치되지 않도록 안전하게 보장됩니다.
- 🏆 **글로벌 스탠딩 실시간 동기화**: 참여자들의 점수와 클리어 보드 수가 갱신되며 실시간 순위표가 제공됩니다.
- 🔗 **초대 링크 및 QR코드 연동**: 모바일 기기로 쉽게 접속하고 관객을 초대할 수 있는 대기방 전용 QR코드 기능을 지원합니다.
- 📱 **모바일 최적화 및 탭/깃발 모드**: 터치스크린 및 롱프레스를 이용한 모바일 특화 조작 방식을 지원합니다.

---

## 🛠 Tech Stack (기술 스택)

### Frontend
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![HTML5 Canvas](https://img.shields.io/badge/HTML5_Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white)

### Backend & Sync
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socket.io&logoColor=white)

### DevOps & Infrastructure
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![PM2](https://img.shields.io/badge/PM2-2B037A?style=for-the-badge&logo=pm2&logoColor=white)
![Naver Cloud](https://img.shields.io/badge/NCP-03C75A?style=for-the-badge&logo=naver&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white)

---

## 🎮 Game Rules (게임 규칙)

1. **승리 조건**: 제한 시간 내에 모든 지뢰찾기 보드를 해결하여 가장 높은 점수를 획득한 플레이어가 1위를 차지합니다.
2. **보드 클리어**: 지뢰가 아닌 모든 칸을 열면 보드가 클리어되며 보드 크기에 비례하는 클리어 보너스 점수를 얻습니다. 클리어 즉시 한 단계 더 큰 보드로 전환됩니다.
3. **지뢰 폭발 (Boom!)**: 지뢰를 누를 경우, 점수 페널티(100점 감점)와 함께 **3초간 입력이 정지(Lockout)**되며, 동일한 레벨 크기의 새로운 보드로 재생성되어 다시 도전해야 합니다.
4. **조작 방식**:
   - **PC**: 마우스 좌클릭(열기), 우클릭(깃발 표시), 이미 숫자가 드러난 칸을 클릭 또는 더블 클릭할 경우 깃발 수가 일치하면 주변 타일이 한번에 열리는 **코드(Chord) 기능** 지원.
   - **모바일**: 터치(열기), 길게 누르기(깃발 표시). 화면 하단의 조작 모드 전환기(⛏️/🚩)를 통해서도 직관적인 탭 조작이 가능합니다.

---

## ⚙️ Deployment Architecture (배포 구조)

```text
[ Client (Vite React Build on CDN/Server) ]
             │ (HTTPS / WSS Connection)
             ▼
   [ NCP Load Balancer ]  <-- SSL Termination (HTTPS/WSS to HTTP/WS)
             │
             ▼
  [ Docker Container (Express + Socket.io Server inside NCP VPC) ]
             │
             ▼ Managed by PM2 (Autorestart on crashes)
```

---

## 🏃 Local Execution (로컬 실행 방법)

### 1. Repository Clone & Setup

프로젝트 의존성을 클라이언트와 서버 각각에 설치합니다.

#### Backend Server
```bash
cd server
npm install
```

#### Frontend Client
```bash
cd client
npm install --legacy-peer-deps
```

### 2. Environment Variables (.env)
`server/` 디렉토리 내에 `.env` 파일을 생성하고 아래와 같이 설정합니다.

```env
NODE_ENV=development
PORT=3000
SOCKET_CORS_ORIGIN=*
```

### 3. Execution (실행)

#### Backend Server 시작 (Port: 3000)
```bash
cd server
npm run dev
```

#### Frontend Client 시작 (Port: 5173)
```bash
cd client
npm run dev
```

브라우저에서 `http://localhost:5173` 으로 접속해 플레이할 수 있습니다. 
여러 개의 브라우저 탭을 열면 실시간 멀티플레이 동작을 완벽하게 테스트할 수 있습니다.
