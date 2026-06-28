import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { StickyNote } from './components/StickyNote';
import './App.css';

// 6가지 브러시 색상 정의
const BRUSH_COLORS = [
  { name: 'Slate', code: '#1e293b' },
  { name: 'Red', code: '#ef4444' },
  { name: 'Blue', code: '#3b82f6' },
  { name: 'Green', code: '#10b981' },
  { name: 'Orange', code: '#f97316' },
  { name: 'Purple', code: '#8b5cf6' }
];

export default function App() {
  const [inLobby, setInLobby] = useState(true);
  const [roomId, setRoomId] = useState('');
  const [roomName, setRoomName] = useState('');
  const [userId] = useState(() => 'user_' + Math.random().toString(36).substring(2, 9));
  
  // 로비 방 목록 및 비밀번호 입력 상태
  const [activeRooms, setActiveRooms] = useState([]);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinPasswordInput, setJoinPasswordInput] = useState('');
  
  // 비밀번호 입력이 필요한 방 ID 상태 (모달 대용)
  const [targetVerifyRoom, setTargetVerifyRoom] = useState(null);
  const [verifyPasswordInput, setVerifyPasswordInput] = useState('');

  // 드로잉 도구 상태 ('pencil', 'eraser', 'converter')
  const [toolMode, setToolMode] = useState('pencil');
  const [brushColor, setBrushColor] = useState('#1e293b');
  const [brushWidth, setBrushWidth] = useState(4);
  
  // 변환기(Converter) 선택 상자 영역 상태
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState({ startX: 0, startY: 0, currentX: 0, currentY: 0 });

  // 포스트잇 상태 관리
  const [stickies, setStickies] = useState([]);
  
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const prevPointRef = useRef({ x: 0, y: 0 });
  const strokePointsRef = useRef([]); // 50ms 동안 발생한 좌표들을 임시 수집할 배열
  const lastSendTimeRef = useRef(0);
  const throttledMoveRefs = useRef({});

  // 캔버스 그리기 함수
  const drawLine = useCallback((x1, y1, x2, y2, color, width, mode) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }
    
    ctx.stroke();
    ctx.closePath();
  }, []);

  // 웹소켓 수신 메시지 처리 핸들러
  const handleWsMessage = useCallback((message) => {
    const { type, payload, user_id } = message;
    
    // 자신이 보낸 메시지는 로컬 캔버스에 이미 그려졌으므로 수신 렌더링에서 스킵 (각진 덮어쓰기 해결)
    if (user_id === userId && (type === 'draw' || type === 'erase')) {
      return;
    }
    
    switch (type) {
      case 'draw':
      case 'erase':
        {
          const points = payload.points;
          if (points && points.length >= 2) {
            for (let i = 1; i < points.length; i++) {
              drawLine(
                points[i - 1][0],
                points[i - 1][1],
                points[i][0],
                points[i][1],
                payload.color,
                payload.lineWidth,
                type // 'draw' 혹은 'erase' 전달
              );
            }
          }
        }
        break;
        
      case 'add_sticky':
        setStickies(prev => {
          if (prev.some(s => s.id === payload.id)) return prev;
          return [...prev, { ...payload, ocrStatus: 'idle', ocrError: null }];
        });
        break;
        
      case 'move_sticky':
        setStickies(prev => prev.map(s => {
          if (s.id === payload.id) {
            return { ...s, x: payload.x, y: payload.y };
          }
          return s;
        }));
        break;
        
      case 'ocr_result':
        setStickies(prev => prev.map(s => {
          if (s.id === payload.sticky_id) {
            return { 
              ...s, 
              text: payload.text, 
              ocrStatus: payload.confidence > 0 ? 'success' : 'error',
              ocrError: payload.confidence > 0 ? null : 'OCR failed.'
            };
          }
          return s;
        }));
        break;
        
      default:
        break;
    }
  }, [drawLine, userId]);

  // WebSocket 훅 사용 (로비에 있을 때는 연결하지 않음)
  const { connectionStatus, userCount, sendMessage, reconnect } = useWebSocket(
    inLobby ? "" : roomId,
    userId,
    handleWsMessage
  );

  // 로비용 활성화된 방 목록 호출
  const fetchActiveRooms = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8000/api/rooms');
      if (response.ok) {
        const data = await response.json();
        setActiveRooms(data);
      }
    } catch (err) {
      console.error('Failed to fetch active rooms:', err);
    }
  };

  // 로비에 있을 때 방 목록 주기적 동기화
  useEffect(() => {
    if (!inLobby) return;
    
    fetchActiveRooms();
    const interval = setInterval(fetchActiveRooms, 3000);
    
    return () => clearInterval(interval);
  }, [inLobby]);

  // 캔버스 크기 조정
  useEffect(() => {
    if (inLobby) return;
    
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(canvas, 0, 0);

      const header = document.querySelector('.header-panel');
      const headerHeight = header ? header.getBoundingClientRect().height : 72;
      
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight - headerHeight;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(tempCanvas, 0, 0);
    };

    window.addEventListener('resize', handleResize);
    const timer = setTimeout(handleResize, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, [inLobby]);

  // 로컬 드로잉 마우스 이벤트 핸들러
  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (toolMode === 'converter') {
      // 변환기 드래그 선택 모드 시작
      setIsSelecting(true);
      setSelectionBox({ startX: x, startY: y, currentX: x, currentY: y });
    } else {
      // 일반 연필/지우개 드로잉 시작
      isDrawingRef.current = true;
      prevPointRef.current = { x, y };
      strokePointsRef.current = [[x, y]]; // 첫 좌표 시작점 담기
      lastSendTimeRef.current = Date.now();
    }
  };

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (toolMode === 'converter') {
      if (isSelecting) {
        setSelectionBox(prev => ({ ...prev, currentX: x, currentY: y }));
      }
    } else {
      if (!isDrawingRef.current) return;
      
      const pPrev = prevPointRef.current;
      const mode = toolMode === 'eraser' ? 'erase' : 'draw';
      
      // 1. 자신의 로컬 화면에는 모든 픽셀 이동에 맞춰 부드럽게 그림
      drawLine(pPrev.x, pPrev.y, x, y, brushColor, brushWidth, mode);
      
      // 2. 50ms 주기 송신을 위해 배열에 중간 이동 지점들 축적
      strokePointsRef.current.push([x, y]);
      
      const now = Date.now();
      if (now - lastSendTimeRef.current >= 50) {
        if (strokePointsRef.current.length > 1) {
          sendMessage(mode, {
            points: strokePointsRef.current,
            color: brushColor,
            lineWidth: brushWidth
          });
          // 배열 축적 리셋하되 다음 부드러운 연결을 위해 현재 마지막 점을 첫 인덱스에 보존
          strokePointsRef.current = [[x, y]];
        }
        lastSendTimeRef.current = now;
      }
      
      prevPointRef.current = { x, y };
    }
  };

  const handleMouseUp = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (toolMode === 'converter') {
      if (isSelecting) {
        setIsSelecting(false);
        
        const startX = selectionBox.startX;
        const startY = selectionBox.startY;
        const endX = selectionBox.currentX;
        const endY = selectionBox.currentY;
        
        const cropX = Math.min(startX, endX);
        const cropY = Math.min(startY, endY);
        const cropW = Math.abs(startX - endX);
        const cropH = Math.abs(startY - endY);
        
        // 최소 크기 제한 (노이즈 드래그 무시)
        if (cropW > 10 && cropH > 10) {
          // 1. 부분 캔버스 생성 및 영역 크롭
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = cropW;
          cropCanvas.height = cropH;
          const cropCtx = cropCanvas.getContext('2d');
          cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
          const base64Image = cropCanvas.toDataURL('image/png');
          
          // 2. 선택 영역 하단 부근에 텍스트 대기용 스티키 생성
          const stickyId = 'sticky_' + Math.random().toString(36).substring(2, 9);
          const newSticky = {
            id: stickyId,
            x: cropX,
            y: cropY + cropH + 15,
            text: 'Converting drawing...',
            color: '#bbf7d0' // OCR용 스티키는 연두색 기본
          };
          
          setStickies(prev => [...prev, { ...newSticky, ocrStatus: 'loading', ocrError: null }]);
          sendMessage('add_sticky', newSticky);
          
          // 3. OCR 호출
          triggerOCR(stickyId, base64Image);
        }
      }
    } else {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      
      const mode = toolMode === 'eraser' ? 'erase' : 'draw';
      strokePointsRef.current.push([x, y]);
      
      if (strokePointsRef.current.length > 1) {
        sendMessage(mode, {
          points: strokePointsRef.current,
          color: brushColor,
          lineWidth: brushWidth
        });
      }
      strokePointsRef.current = [];
    }
  };

  // OCR 호출 처리 트리거
  const triggerOCR = async (stickyId, base64Image) => {
    try {
      const response = await fetch('http://127.0.0.1:8000/api/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_base64: base64Image,
          room_id: roomId,
          sticky_id: stickyId
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }
      
      const data = await response.json();
      console.log('OCR Task Queued successfully:', data);
    } catch (err) {
      console.error('OCR API Error:', err);
      // 에러 발생 시 포스트잇 텍스트 영역에 오류 안내
      setStickies(prev => prev.map(s => {
        if (s.id === stickyId) {
          return { 
            ...s, 
            ocrStatus: 'error', 
            text: `OCR Failed: ${err.message || 'Network request error'}` 
          };
        }
        return s;
      }));
    }
  };

  // 포스트잇 신규 추가 (툴바 수동 추가)
  const handleAddSticky = () => {
    const id = 'sticky_' + Math.random().toString(36).substring(2, 9);
    const newSticky = {
      id,
      x: window.innerWidth / 2 - 100 + (Math.random() - 0.5) * 100,
      y: window.innerHeight / 2 - 100 + (Math.random() - 0.5) * 100,
      text: '',
      color: '#fef08a'
    };

    setStickies(prev => [...prev, { ...newSticky, ocrStatus: 'idle', ocrError: null }]);
    sendMessage('add_sticky', newSticky);
  };

  const handleStickyMove = (id, newX, newY) => {
    setStickies(prev => prev.map(s => {
      if (s.id === id) return { ...s, x: newX, y: newY };
      return s;
    }));

    const now = Date.now();
    if (!throttledMoveRefs.current[id] || now - throttledMoveRefs.current[id] >= 50) {
      sendMessage('move_sticky', { id, x: newX, y: newY });
      throttledMoveRefs.current[id] = now;
    }
  };

  const handleStickyTextChange = (id, newText) => {
    setStickies(prev => prev.map(s => {
      if (s.id === id) return { ...s, text: newText };
      return s;
    }));
  };

  const handleStickyColorChange = (id, newColor) => {
    setStickies(prev => prev.map(s => {
      if (s.id === id) return { ...s, color: newColor };
      return s;
    }));
  };

  const handleStickyDelete = (id) => {
    setStickies(prev => prev.filter(s => s.id !== id));
  };

  // 방 생성 처리
  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!newRoomName.trim()) {
      alert('방 이름을 입력해 주세요.');
      return;
    }

    try {
      const response = await fetch('http://127.0.0.1:8000/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_name: newRoomName.trim(),
          password: newRoomPassword
        })
      });

      if (!response.ok) {
        throw new Error('방 생성에 실패했습니다.');
      }

      const data = await response.json();
      setRoomId(data.room_id);
      setRoomName(data.room_name);
      setInLobby(false);
      setNewRoomName('');
      setNewRoomPassword('');
    } catch (err) {
      alert(err.message);
    }
  };

  // 방 입장 비밀번호 확인 및 진입 처리
  const handleJoinVerify = async (e) => {
    e.preventDefault();
    if (!targetVerifyRoom) return;

    try {
      const response = await fetch(`http://127.0.0.1:8000/api/rooms/${targetVerifyRoom.room_id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: verifyPasswordInput })
      });

      if (response.status === 403) {
        alert('비밀번호가 올바르지 않습니다.');
        return;
      }
      if (!response.ok) {
        throw new Error('인증 실패');
      }

      setRoomId(targetVerifyRoom.room_id);
      setRoomName(targetVerifyRoom.room_name);
      setInLobby(false);
      setTargetVerifyRoom(null);
      setVerifyPasswordInput('');
    } catch (err) {
      alert('방 입장에 실패했습니다: ' + err.message);
    }
  };

  // 목록 클릭 시 혹은 코드로 참가 시 방 입장 흐름 제어
  const handleTryJoinRoom = (room) => {
    if (room.has_password) {
      setTargetVerifyRoom(room);
    } else {
      setRoomId(room.room_id);
      setRoomName(room.room_name);
      setInLobby(false);
    }
  };

  // 코드를 직접 타이핑하여 입장
  const handleJoinByCode = async (e) => {
    e.preventDefault();
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) {
      alert('방 코드를 입력해 주세요.');
      return;
    }

    const foundRoom = activeRooms.find(r => r.room_id === code);
    if (foundRoom) {
      handleTryJoinRoom(foundRoom);
      setJoinCodeInput('');
      setJoinPasswordInput('');
    } else {
      try {
        const response = await fetch(`http://127.0.0.1:8000/api/rooms/${code}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: joinPasswordInput })
        });

        if (response.status === 404) {
          alert('존재하지 않거나 만료된 방 코드입니다.');
          return;
        }
        if (response.status === 403) {
          alert('비밀번호가 틀렸습니다.');
          return;
        }
        if (!response.ok) {
          throw new Error('인증 에러');
        }

        setRoomId(code);
        setRoomName(`Room ${code}`);
        setInLobby(false);
        setJoinCodeInput('');
        setJoinPasswordInput('');
      } catch (err) {
        alert('방 코드로 입장 실패: ' + err.message);
      }
    }
  };

  // 방 나가기
  const handleLeaveRoom = () => {
    setInLobby(true);
    setRoomId('');
    setRoomName('');
    setStickies([]);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  // 1. 로비 화면 렌더링
  if (inLobby) {
    return (
      <div className="lobby-container">
        {targetVerifyRoom && (
          <div className="modal-overlay">
            <div className="modal-card">
              <h3>🔒 Password Required</h3>
              <p>"{targetVerifyRoom.room_name}" 방에 입장하려면 비밀번호가 필요합니다.</p>
              <form onSubmit={handleJoinVerify}>
                <input
                  type="password"
                  placeholder="Enter Password"
                  value={verifyPasswordInput}
                  onChange={(e) => setVerifyPasswordInput(e.target.value)}
                  autoFocus
                  required
                />
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setTargetVerifyRoom(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    Join
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <header className="lobby-header">
          <div className="app-title">
            <span className="logo-icon">🪄</span>
            <h1>Co-Whiteboard Lobby</h1>
          </div>
          <span className="user-id-tag">ID: {userId}</span>
        </header>

        <div className="lobby-content">
          <div className="lobby-panel create-panel">
            <h2>✨ Create Room</h2>
            <p className="panel-desc">새로운 협업 화이트보드를 개설합니다.</p>
            <form onSubmit={handleCreateRoom}>
              <div className="form-group">
                <label>Room Name</label>
                <input
                  type="text"
                  placeholder="Enter room name"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Password <span className="label-sub">(Optional)</span></label>
                <input
                  type="password"
                  placeholder="Leave empty for public room"
                  value={newRoomPassword}
                  onChange={(e) => setNewRoomPassword(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-primary btn-block">
                Create & Enter Room
              </button>
            </form>
          </div>

          <div className="lobby-panel join-panel">
            <h2>🔑 Join Room</h2>
            <p className="panel-desc">방 코드(6자리)를 입력해 접속합니다.</p>
            <form onSubmit={handleJoinByCode} className="join-code-form">
              <input
                type="text"
                placeholder="ROOM CODE (e.g. AB3X7K)"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
                className="code-input"
                maxLength={6}
                required
              />
              <input
                type="password"
                placeholder="Password (if protected)"
                value={joinPasswordInput}
                onChange={(e) => setJoinPasswordInput(e.target.value)}
                className="pwd-input"
              />
              <button type="submit" className="btn-primary btn-block">
                Join by Code
              </button>
            </form>

            <div className="active-list-header">
              <h3>🌐 Active Rooms</h3>
              <button className="refresh-btn" onClick={fetchActiveRooms} title="Refresh List">
                🔄 Refresh
              </button>
            </div>
            
            <div className="rooms-list">
              {activeRooms.length === 0 ? (
                <div className="no-rooms">
                  <p>현재 개설된 활성 방이 없습니다.</p>
                  <span className="no-rooms-sub">첫 번째 화이트보드를 직접 만들어보세요!</span>
                </div>
              ) : (
                activeRooms.map((room) => (
                  <div key={room.room_id} className="room-card">
                    <div className="room-info">
                      <div className="room-name-row">
                        <h4>{room.room_name}</h4>
                        {room.has_password && <span className="lock-icon" title="Password Protected">🔒</span>}
                      </div>
                      <span className="room-code-tag">Code: {room.room_id}</span>
                    </div>
                    <div className="room-card-right">
                      <span className="room-users">👥 {room.active_users}</span>
                      <button className="btn-join-room" onClick={() => handleTryJoinRoom(room)}>
                        Join
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. 화이트보드 작업 화면 렌더링
  return (
    <div className="app-container">
      <header className="header-panel">
        <div className="header-left">
          <div className="app-title">
            <span className="logo-icon">🪄</span>
            <h1>{roomName}</h1>
            <span className="room-code-badge">{roomId}</span>
          </div>
        </div>

        {/* 툴바 영역 */}
        <div className="toolbar-panel">
          <div className="tool-selector-group">
            {/* 펜 툴 */}
            <button
              className={`tool-btn ${toolMode === 'pencil' ? 'active' : ''}`}
              onClick={() => setToolMode('pencil')}
              title="Pencil Tool"
            >
              ✏️ Pencil
            </button>
            
            {/* 지우개 툴 */}
            <button
              className={`tool-btn eraser-btn ${toolMode === 'eraser' ? 'active' : ''}`}
              onClick={() => setToolMode('eraser')}
              title="Toggle Eraser"
            >
              🧽 Eraser
            </button>
            
            {/* 변환기(OCR 크롭) 툴 */}
            <button
              className={`tool-btn converter-btn ${toolMode === 'converter' ? 'active' : ''}`}
              onClick={() => setToolMode('converter')}
              title="OCR Selection Area"
            >
              🔍 Converter (OCR)
            </button>
          </div>

          <div className="divider" />

          {/* 브러시 색상 (변환기 모드가 아닐 때만 노출/활성화) */}
          <div className="color-picker-group" style={{ opacity: toolMode === 'converter' ? 0.3 : 1 }}>
            {BRUSH_COLORS.map(c => (
              <button
                key={c.code}
                className={`brush-color-btn ${brushColor === c.code && toolMode === 'pencil' ? 'active' : ''}`}
                style={{ backgroundColor: c.code }}
                disabled={toolMode === 'converter'}
                onClick={() => {
                  setBrushColor(c.code);
                  setToolMode('pencil');
                }}
                title={c.name}
              />
            ))}
          </div>

          <div className="divider" />

          {/* 브러시 크기 슬라이더 (변환기 모드가 아닐 때만 노출/활성화) */}
          <div className="brush-slider-group" style={{ opacity: toolMode === 'converter' ? 0.3 : 1 }}>
            <span className="slider-label">Size:</span>
            <input
              type="range"
              min="1"
              max="20"
              disabled={toolMode === 'converter'}
              value={brushWidth}
              onChange={(e) => setBrushWidth(parseInt(e.target.value))}
            />
            <span className="slider-value">{brushWidth}px</span>
          </div>

          <div className="divider" />

          <button className="tool-btn add-sticky-btn" onClick={handleAddSticky}>
            📝 Add Sticky
          </button>
        </div>

        <div className="header-right">
          {/* 연결 인디케이터 */}
          <div className={`status-indicator ${connectionStatus.toLowerCase()}`}>
            <span className="status-dot" />
            <span className="status-text">
              {connectionStatus === 'CONNECTED' && 'Connected'}
              {connectionStatus === 'DISCONNECTED' && 'Disconnected'}
              {connectionStatus === 'RECONNECTING' && 'Reconnecting...'}
            </span>
            {connectionStatus === 'DISCONNECTED' && (
              <button className="reconnect-btn" onClick={reconnect}>Connect</button>
            )}
          </div>

          {/* 접속자 수 표시 */}
          <div className="user-count-badge">
            👥 <span className="count-number">{userCount}</span> Users
          </div>

          {/* 나가기 버튼 */}
          <button className="leave-room-btn" onClick={handleLeaveRoom}>
            🚪 Leave
          </button>
        </div>
      </header>

      {/* 화이트보드 작업 영역 */}
      <main className="board-workspace">
        <canvas
          ref={canvasRef}
          className="whiteboard-canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />

        {/* 변환기(OCR) 영역 드래그 피드백 용 선택 상자 */}
        {toolMode === 'converter' && isSelecting && (
          <div
            className="selection-box"
            style={{
              left: `${Math.min(selectionBox.startX, selectionBox.currentX)}px`,
              top: `${Math.min(selectionBox.startY, selectionBox.currentY)}px`,
              width: `${Math.abs(selectionBox.startX - selectionBox.currentX)}px`,
              height: `${Math.abs(selectionBox.startY - selectionBox.currentY)}px`
            }}
          />
        )}

        {/* 렌더링된 포스트잇 레이어 */}
        {stickies.map(s => (
          <StickyNote
            key={s.id}
            {...s}
            onMove={handleStickyMove}
            onTextChange={handleStickyTextChange}
            onColorChange={handleStickyColorChange}
            onDelete={handleStickyDelete}
          />
        ))}
      </main>
    </div>
  );
}
