import { useEffect, useState, useRef } from 'react';
import { useSocket } from './hooks/useSocket';
import { useMinesweeper } from './hooks/useMinesweeper';
import { Lobby } from './components/Lobby';
import { MinesweeperBoard } from './components/MinesweeperBoard';
import { Scoreboard } from './components/Scoreboard';
import { ThumbnailGrid } from './components/ThumbnailGrid';
import { ResultScreen } from './components/ResultScreen';
import { Clock, LogOut } from 'lucide-react';
import { ThemeBackgrounds } from './components/ThemeBackgrounds';
import './styles/game.css';

function App() {
  const [theme, setTheme] = useState<'retro' | 'minimal' | 'minemine'>(
    () => (localStorage.getItem('theme') as any) || 'minemine'
  );

  useEffect(() => {
    document.body.className = `theme-${theme}`;
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Manage background animation pausing on tab hidden
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        document.body.classList.add('animations-paused');
      } else {
        document.body.classList.remove('animations-paused');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const {
    socket,
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
  } = useSocket();

  const handleStateChange = (score: number, boardsCleared: number, boardState: any) => {
    sendProgress(score, boardsCleared, boardState);
  };

  const {
    board,
    gameState,
    totalScore,
    currentBoardScore,
    boardsCleared,
    level,
    penaltyActive,
    penaltyTimeLeft,
    size,
    resetGame,
    revealCell,
    toggleFlag,
    chordCell
  } = useMinesweeper(handleStateChange);

  const prevGameStartedRef = useRef(false);

  // Trigger game start board reset on transition
  useEffect(() => {
    const wasStarted = prevGameStartedRef.current;
    const isStarted = !!room?.isGameStarted;

    if (isStarted && !wasStarted && !room?.isGameOver) {
      console.log('Game starting! Resetting board to level 1.');
      resetGame(1, false);
    }

    prevGameStartedRef.current = isStarted;
  }, [room?.isGameStarted, room?.isGameOver, resetGame]);

  // Format time (seconds -> MM:SS)
  const formatTime = (secs: number) => {
    const minutes = Math.floor(secs / 60);
    const seconds = secs % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // If not connected to socket, show loading status
  if (!isConnected && !room) {
    return (
      <div className="app-container app-loading">
        <ThemeBackgrounds theme={theme} />
        <div className="loader"></div>
        <p>Connecting to Minemine Server...</p>
      </div>
    );
  }

  // Lobby (Room setup & Waiting)
  if (!room || !room.isGameStarted) {
    return (
      <div className="app-container app-lobby">
        <ThemeBackgrounds theme={theme} />
        <Lobby
          room={room}
          isConnected={isConnected}
          error={error}
          myId={socket?.id}
          theme={theme}
          setTheme={setTheme}
          createRoom={createRoom}
          joinRoom={joinRoom}
          leaveRoom={leaveRoom}
          setReady={setReady}
          updateConfig={updateConfig}
          startGame={startGame}
          setError={setError}
        />
      </div>
    );
  }

  // Result Screen (Game Over)
  if (room.isGameOver) {
    return (
      <div className="app-container app-result">
        <ThemeBackgrounds theme={theme} />
        <ResultScreen
          room={room}
          myId={socket?.id}
          requestRematch={requestRematch}
          leaveRoom={leaveRoom}
        />
      </div>
    );
  }

  // Active Game screen
  return (
    <div className="app-container app-game-active">
      <ThemeBackgrounds theme={theme} />
      {/* HUD Header */}
      <header className="game-header glass-panel">
        <div className="header-logo">
          <h1>MINEMINE {theme === 'minemine' && '🐦'}</h1>
        </div>

        <div className="header-timer">
          <Clock size={20} className={timer <= 15 ? 'timer-critical-icon' : ''} />
          <span className={`timer-value font-mono ${timer <= 15 ? 'timer-critical' : ''}`}>
            {formatTime(timer)}
          </span>
        </div>

        <div className="header-actions">
          <button onClick={leaveRoom} className="btn btn-secondary btn-icon-label">
            <LogOut size={16} /> Quit Game
          </button>
        </div>
      </header>

      {/* Main Game Screen Grid Layout */}
      <main className="game-layout">
        {/* Left/Center Panel - The Player's Minefield */}
        <section className="main-board-section glass-panel">
          <MinesweeperBoard
            board={board}
            gameState={gameState}
            size={size}
            level={level}
            score={totalScore}
            currentBoardScore={currentBoardScore}
            boardsCleared={boardsCleared}
            penaltyActive={penaltyActive}
            penaltyTimeLeft={penaltyTimeLeft}
            revealCell={revealCell}
            toggleFlag={toggleFlag}
            chordCell={chordCell}
          />
        </section>

        {/* Right Panel - Standings and Opponent Mini-boards */}
        <aside className="multiplayer-sidebar">
          {/* Live Score Standings */}
          <Scoreboard
            players={room.players}
            myId={socket?.id}
            otherPlayersProgress={otherPlayersProgress}
          />

          {/* Opponent Boards Miniature Previews */}
          <ThumbnailGrid
            players={room.players}
            myId={socket?.id}
            otherPlayersProgress={otherPlayersProgress}
          />
        </aside>
      </main>
    </div>
  );
}

export default App;
