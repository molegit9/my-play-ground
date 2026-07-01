import { RoomManager } from './roomManager.js';

export function setupSocketHandlers(io) {
  const roomManager = new RoomManager();

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Create Room
    socket.on('create-room', ({ nickname }) => {
      const room = roomManager.createRoom(socket.id, nickname);
      socket.join(room.id);
      socket.emit('room-details', room);
      console.log(`Room created: ${room.id} by ${nickname}`);
    });

    // Join Room
    socket.on('join-room', ({ roomId, nickname }) => {
      const oldRoomId = roomManager.playerRoomMap.get(socket.id);
      
      const result = roomManager.joinRoom(roomId, socket.id, nickname);
      if (result.error) {
        socket.emit('join-error', result.error);
        return;
      }
      
      // If switching rooms, leave the old Socket.IO room channel on the server and update other players
      if (oldRoomId && oldRoomId !== roomId) {
        socket.leave(oldRoomId);
        const oldRoom = roomManager.rooms.get(oldRoomId);
        if (oldRoom) {
          io.to(oldRoomId).emit('room-updated', oldRoom);
          io.to(oldRoomId).emit('player-disconnected', { playerId: socket.id });
        }
      }
      
      socket.join(roomId);
      // Notify the joining player
      socket.emit('room-details', result.room);
      // Notify other players in the room
      socket.to(roomId).emit('room-updated', result.room);
      console.log(`Player ${nickname} (${socket.id}) joined room ${roomId}`);
    });

    // Toggle Ready State
    socket.on('set-ready', ({ isReady }) => {
      const room = roomManager.setReady(socket.id, isReady);
      if (room) {
        io.to(room.id).emit('room-updated', room);
      }
    });

    // Update Room Config (Host only)
    socket.on('update-config', (config) => {
      const room = roomManager.updateConfig(socket.id, config);
      if (room) {
        io.to(room.id).emit('room-updated', room);
      }
    });

    // Start Game (Host only)
    socket.on('start-game', () => {
      const playerRoom = roomManager.getRoomByPlayerId(socket.id);
      if (!playerRoom) return;

      if (playerRoom.hostId !== socket.id) {
        socket.emit('error-msg', 'Only the host can start the game.');
        return;
      }

      const onTick = (roomId, timer) => {
        io.to(roomId).emit('game-tick', { timer });
      };

      const onTimeUp = (roomId, finalRoomState) => {
        io.to(roomId).emit('game-over', finalRoomState);
      };

      const result = roomManager.startGame(playerRoom.id, onTick, onTimeUp);
      if (result.error) {
        socket.emit('error-msg', result.error);
        return;
      }

      io.to(playerRoom.id).emit('game-started', result.room);
      console.log(`Game started in room ${playerRoom.id}`);
    });

    // Update Score / Board Progress
    socket.on('update-progress', ({ score, boardsCleared, boardState }) => {
      const room = roomManager.updatePlayerProgress(socket.id, score, boardsCleared, boardState);
      if (room) {
        // Send updates to other players in the room
        socket.to(room.id).emit('player-progress', {
          playerId: socket.id,
          score,
          boardsCleared,
          boardState
        });
      }
    });

    // Request Rematch
    socket.on('rematch', () => {
      const room = roomManager.getRoomByPlayerId(socket.id);
      if (!room || !room.isGameOver) return;

      // Reset room state so players can play again
      roomManager.stopGame(room.id);
      room.isGameStarted = false;
      room.isGameOver = false;
      room.timer = room.config.timeLimit;
      
      // Keep everyone in the room but set non-hosts to NOT ready, host to ready
      room.players.forEach(p => {
        p.isReady = (p.id === room.hostId);
        p.score = 0;
        p.boardsCleared = 0;
        p.isDead = false;
        p.boardState = null;
      });

      io.to(room.id).emit('room-updated', room);
      io.to(room.id).emit('game-reset');
      console.log(`Room ${room.id} reset for rematch`);
    });

    // Leave Room / Disconnect
    const handleLeave = () => {
      const leaveResult = roomManager.leaveRoom(socket.id);
      if (leaveResult) {
        const { roomId, roomDeleted, room } = leaveResult;
        socket.leave(roomId);
        if (!roomDeleted && room) {
          io.to(roomId).emit('room-updated', room);
          // Also let others know that this player disconnected
          io.to(roomId).emit('player-disconnected', { playerId: socket.id });
        }
        console.log(`Player ${socket.id} left room ${roomId}`);
      }
    };

    socket.on('leave-room', handleLeave);
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
      handleLeave();
    });
  });
}
