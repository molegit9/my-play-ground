import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 실시간 WebSocket 통신 및 자동 재연결(지수 백오프)을 관리하는 커스텀 훅
 * 
 * @param {string} roomId 룸 ID
 * @param {string} userId 사용자 ID
 * @param {function} onMessageReceived 메시지 수신 시 호출될 콜백 함수
 */
export function useWebSocket(roomId, userId, onMessageReceived) {
  const [connectionStatus, setConnectionStatus] = useState('DISCONNECTED'); // CONNECTED, DISCONNECTED, RECONNECTING
  const [userCount, setUserCount] = useState(1);
  const socketRef = useRef(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const isManuallyClosedRef = useRef(false);

  const connect = useCallback(() => {
    if (!roomId || !userId) return;

    if (socketRef.current) {
      socketRef.current.close();
    }

    setConnectionStatus('RECONNECTING');
    isManuallyClosedRef.current = false;
    
    const wsHost = window.location.hostname === 'localhost' ? '127.0.0.1' : (window.location.hostname || '127.0.0.1');
    const wsUrl = `ws://${wsHost}:8000/ws/${roomId}?user_id=${userId}`;
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected successfully.');
      setConnectionStatus('CONNECTED');
      reconnectCountRef.current = 0; // 재연결 횟수 초기화
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        // 시스템 관련 특수 메시지(유저 수 업데이트) 가로채기
        if (message.type === 'user_count') {
          if (message.payload && typeof message.payload.count === 'number') {
            setUserCount(message.payload.count);
          }
        }
        
        // 외부 콜백 실행
        onMessageReceived(message);
      } catch (err) {
        console.error('Error parsing incoming WebSocket message:', err);
      }
    };

    ws.onclose = (event) => {
      console.log('WebSocket closed:', event);
      setConnectionStatus('DISCONNECTED');

      // 수동으로 닫은 게 아니고, 재연결 횟수가 3회 미만이면 재시도 (지수 백오프)
      if (!isManuallyClosedRef.current && reconnectCountRef.current < 3) {
        const backoffTime = Math.pow(2, reconnectCountRef.current) * 1000; // 1s, 2s, 4s
        reconnectCountRef.current += 1;
        setConnectionStatus('RECONNECTING');
        console.log(`Reconnecting in ${backoffTime}ms... (Attempt ${reconnectCountRef.current}/3)`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, backoffTime);
      } else if (reconnectCountRef.current >= 3) {
        console.warn('Max WebSocket reconnection attempts (3) reached.');
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket connection error:', err);
    };
  }, [roomId, userId, onMessageReceived]);

  // 방이나 유저 정보가 바뀔 때 소켓 재설정
  useEffect(() => {
    connect();
    
    return () => {
      isManuallyClosedRef.current = true;
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  // 메시지 전송 유틸리티 함수
  const sendMessage = useCallback((type, payload) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const msgObj = {
        type,
        payload,
        user_id: userId,
        timestamp: new Date().toISOString()
      };
      socketRef.current.send(JSON.stringify(msgObj));
    } else {
      console.warn('Cannot send message. WebSocket is not open.');
    }
  }, [userId]);

  return {
    connectionStatus,
    userCount,
    sendMessage,
    reconnect: connect
  };
}
