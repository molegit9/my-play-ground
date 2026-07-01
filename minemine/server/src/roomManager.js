export class RoomManager {
  constructor() {
    this.rooms = new Map();
    // Map socketId -> roomId to quickly lookup which room a player is in
    this.playerRoomMap = new Map();
    // Map roomId -> setInterval ID
    this.intervals = new Map();
  }

  createRoom(hostId, nickname) {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const player = {
      id: hostId,
      nickname: nickname || `Player_${hostId.substring(0, 4)}`,
      isReady: true, // Host is ready by default
      score: 0,
      boardsCleared: 0,
      isDead: false,
      boardState: null // Will hold simple grid dimensions/revealed structure for thumbnails
    };

    const room = {
      id: roomId,
      hostId: hostId,
      players: [player],
      config: {
        timeLimit: 120, // default 120 seconds
        maxPlayers: 8 // default max players
      },
      isGameStarted: false,
      isGameOver: false,
      timer: 120
    };

    this.rooms.set(roomId, room);
    this.playerRoomMap.set(hostId, roomId);
    return room;
  }

  joinRoom(roomId, playerId, nickname) {
    const cleanRoomId = roomId.trim().toUpperCase();
    const room = this.rooms.get(cleanRoomId);
    if (!room) {
      return { error: 'Room not found.' };
    }

    if (room.isGameStarted) {
      return { error: 'Game has already started.' };
    }

    if (room.players.length >= room.config.maxPlayers) {
      return { error: 'Room is full.' };
    }

    // Check if player is already in a room
    if (this.playerRoomMap.has(playerId)) {
      this.leaveRoom(playerId);
    }

    const player = {
      id: playerId,
      nickname: nickname || `Player_${playerId.substring(0, 4)}`,
      isReady: false,
      score: 0,
      boardsCleared: 0,
      isDead: false,
      boardState: null
    };

    room.players.push(player);
    this.playerRoomMap.set(playerId, cleanRoomId);
    return { room };
  }

  leaveRoom(playerId) {
    const roomId = this.playerRoomMap.get(playerId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) {
      this.playerRoomMap.delete(playerId);
      return null;
    }

    // Remove player
    room.players = room.players.filter(p => p.id !== playerId);
    this.playerRoomMap.delete(playerId);

    // If host leaves, reassign host or delete room
    if (room.hostId === playerId) {
      if (room.players.length > 0) {
        room.hostId = room.players[0].id;
        // Make the new host ready
        room.players[0].isReady = true;
      } else {
        // Clear timer if running
        const interval = this.intervals.get(roomId);
        if (interval) {
          clearInterval(interval);
          this.intervals.delete(roomId);
        }
        this.rooms.delete(roomId);
        return { roomId, roomDeleted: true };
      }
    }

    return { roomId, roomDeleted: false, room };
  }

  setReady(playerId, isReady) {
    const roomId = this.playerRoomMap.get(playerId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;

    const player = room.players.find(p => p.id === playerId);
    if (player) {
      // Host is always ready
      if (room.hostId === playerId) {
        player.isReady = true;
      } else {
        player.isReady = isReady;
      }
    }
    return room;
  }

  updateConfig(playerId, config) {
    const roomId = this.playerRoomMap.get(playerId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room || room.hostId !== playerId || room.isGameStarted) return null;

    if (config.timeLimit) {
      room.config.timeLimit = parseInt(config.timeLimit, 10);
      room.timer = room.config.timeLimit;
    }
    if (config.maxPlayers) {
      room.config.maxPlayers = parseInt(config.maxPlayers, 10);
    }

    return room;
  }

  getRoomByPlayerId(playerId) {
    const roomId = this.playerRoomMap.get(playerId);
    if (!roomId) return null;
    return this.rooms.get(roomId);
  }

  startGame(roomId, onTick, onTimeUp) {
    const room = this.rooms.get(roomId);
    if (!room || room.isGameStarted) return null;

    // Check if everyone is ready
    const allReady = room.players.every(p => p.isReady);
    if (!allReady) {
      return { error: 'Not all players are ready.' };
    }

    room.isGameStarted = true;
    room.isGameOver = false;
    room.timer = room.config.timeLimit;
    
    // Reset player scores
    room.players.forEach(p => {
      p.score = 0;
      p.boardsCleared = 0;
      p.isDead = false;
      p.boardState = null;
    });

    const interval = setInterval(() => {
      room.timer--;
      if (room.timer <= 0) {
        clearInterval(interval);
        this.intervals.delete(roomId);
        room.isGameOver = true;
        onTimeUp(roomId, room);
      } else {
        onTick(roomId, room.timer);
      }
    }, 1000);

    this.intervals.set(roomId, interval);

    return { room };
  }

  stopGame(roomId) {
    const interval = this.intervals.get(roomId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(roomId);
    }
  }

  updatePlayerProgress(playerId, score, boardsCleared, boardState) {
    const roomId = this.playerRoomMap.get(playerId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room || !room.isGameStarted || room.isGameOver) return null;

    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.score = score;
      player.boardsCleared = boardsCleared;
      player.boardState = boardState; // simplified format (e.g. { width, height, cells: [type] })
    }
    return room;
  }
}
