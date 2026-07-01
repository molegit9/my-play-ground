import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export interface Player {
  id: string;
  nickname: string;
  isReady: boolean;
  score: number;
  boardsCleared: number;
  isDead: boolean;
  boardState: any; // thumbnail format: { width, height, cells }
}

export interface RoomConfig {
  timeLimit: number;
  maxPlayers: number;
}

export interface Room {
  id: string;
  hostId: string;
  players: Player[];
  config: RoomConfig;
  isGameStarted: boolean;
  isGameOver: boolean;
  timer: number;
}

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 
  (window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin);

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [otherPlayersProgress, setOtherPlayersProgress] = useState<Record<string, Partial<Player>>>({});
  const [timer, setTimer] = useState<number>(120);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Determine connection protocol (wss:// for secure sites, ws:// otherwise)
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const connectionUrl = SOCKET_URL.startsWith('http') 
      ? SOCKET_URL.replace(/^http/, protocol) 
      : `${protocol}://${window.location.host}`;

    console.log(`Connecting to socket at: ${connectionUrl}`);
    const socket = io(connectionUrl, {
      transports: ['websocket'],
      secure: window.location.protocol === 'https:'
    });
    
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      setError(null);
      console.log('Connected to server');
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      setRoom(null);
      setOtherPlayersProgress({});
      console.log('Disconnected from server');
    });

    socket.on('room-details', (roomDetails: Room) => {
      setRoom(roomDetails);
      setTimer(roomDetails.config.timeLimit);
      setOtherPlayersProgress({});
      setError(null);
    });

    socket.on('room-updated', (updatedRoom: Room) => {
      setRoom(updatedRoom);
      setTimer(updatedRoom.timer);
    });

    socket.on('join-error', (errMsg: string) => {
      setError(errMsg);
    });

    socket.on('error-msg', (errMsg: string) => {
      alert(errMsg);
    });

    socket.on('game-started', (roomDetails: Room) => {
      setRoom(roomDetails);
      setTimer(roomDetails.config.timeLimit);
      setOtherPlayersProgress({});
    });

    socket.on('game-tick', ({ timer: currentTimer }: { timer: number }) => {
      setTimer(currentTimer);
    });

    socket.on('game-over', (finalRoom: Room) => {
      setRoom(finalRoom);
    });

    socket.on('game-reset', () => {
      setOtherPlayersProgress({});
      setError(null);
    });

    socket.on('player-progress', ({ playerId, score, boardsCleared, boardState }) => {
      setOtherPlayersProgress((prev) => ({
        ...prev,
        [playerId]: {
          id: playerId,
          score,
          boardsCleared,
          boardState
        }
      }));
    });

    socket.on('player-disconnected', ({ playerId }) => {
      setOtherPlayersProgress((prev) => {
        const next = { ...prev };
        delete next[playerId];
        return next;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const createRoom = useCallback((nickname: string) => {
    socketRef.current?.emit('create-room', { nickname });
  }, []);

  const joinRoom = useCallback((roomId: string, nickname: string) => {
    socketRef.current?.emit('join-room', { roomId, nickname });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit('leave-room');
    setRoom(null);
    setOtherPlayersProgress({});
    setError(null);
  }, []);

  const setReady = useCallback((isReady: boolean) => {
    socketRef.current?.emit('set-ready', { isReady });
  }, []);

  const updateConfig = useCallback((config: Partial<RoomConfig>) => {
    socketRef.current?.emit('update-config', config);
  }, []);

  const startGame = useCallback(() => {
    socketRef.current?.emit('start-game');
  }, []);

  const sendProgress = useCallback((score: number, boardsCleared: number, boardState: any) => {
    socketRef.current?.emit('update-progress', { score, boardsCleared, boardState });
  }, []);

  const requestRematch = useCallback(() => {
    socketRef.current?.emit('rematch');
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
    room,
    otherPlayersProgress,
    timer,
    error,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    updateConfig,
    startGame,
    sendProgress,
    requestRematch,
    setError
  };
}
