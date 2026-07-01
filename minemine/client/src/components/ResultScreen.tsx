import { useEffect } from 'react';
import type { Room } from '../hooks/useSocket';
import { Trophy, Home, RotateCcw, Medal } from 'lucide-react';
import confetti from 'canvas-confetti';

interface ResultScreenProps {
  room: Room;
  myId: string | undefined;
  requestRematch: () => void;
  leaveRoom: () => void;
}

export function ResultScreen({ room, myId, requestRematch, leaveRoom }: ResultScreenProps) {
  // Sort players by final score
  const finalStandings = [...room.players].sort((a, b) => b.score - a.score);
  
  // Find my standing
  const myRankIndex = finalStandings.findIndex(p => p.id === myId);
  const myRank = myRankIndex + 1;
  const isWinner = myRank === 1;

  // Trigger confetti burst if the local player won!
  useEffect(() => {
    if (isWinner) {
      // Fire confetti bursts for 3 seconds
      const duration = 3 * 1000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 5,
          angle: 60,
          spread: 55,
          origin: { x: 0 }
        });
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 55,
          origin: { x: 1 }
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };
      
      frame();
    }
  }, [isWinner]);
  // Check if my rematch status is set. In server, when rematch starts, it clears all scores and ready states.
  // Wait, if a player clicked rematch, do we track ready state?
  // Let's check our setup: when rematch event triggers, server resets isGameStarted=false, resets score, sets non-hosts isReady=false and host isReady=true.
  // So returning to Lobby happens automatically because isGameStarted becomes false.
  // Wait, does "rematch" button instantly trigger a reset or just set ready?
  // In `socketHandlers.js`:
  // `socket.on('rematch', () => { ... io.to(room.id).emit('room-updated', room); ... })`
  // Yes! The rematch event is sent by any player, and the server resets the room back to the lobby state for everyone!
  // So clicking "Play Again" calls `requestRematch()` which resets the game on the server, moving all players back to the waiting room.
  // This is a seamless, zero-wait flow!

  return (
    <div className="lobby-container glass-container result-screen animated zoomIn">
      <div className="result-header">
        <Trophy size={48} className={isWinner ? 'trophy-gold bounce' : 'trophy-gray'} />
        <h1 className="logo">{isWinner ? 'VICTORY!' : 'GAME OVER'}</h1>
        <p className="subtitle">
          {isWinner 
            ? 'You conquered the mines and defeated the competition!' 
            : `You placed #${myRank} out of ${room.players.length} players.`}
        </p>
      </div>

      <div className="card standings-card">
        <h3>FINAL STANDINGS</h3>
        
        <div className="result-table">
          <div className="table-header">
            <span>Rank</span>
            <span>Player</span>
            <span>Score</span>
            <span>Cleared</span>
          </div>

          <div className="table-rows">
            {finalStandings.map((p, index) => {
              const rank = index + 1;
              const isPlayerMe = p.id === myId;
              const isPlayerWinner = rank === 1;

              return (
                <div 
                  key={p.id} 
                  className={`table-row ${isPlayerMe ? 'is-me' : ''} ${isPlayerWinner ? 'winner-row' : ''}`}
                >
                  <div className="cell-rank">
                    {rank === 1 ? (
                      <Medal size={18} className="medal-gold" />
                    ) : rank === 2 ? (
                      <Medal size={18} className="medal-silver" />
                    ) : rank === 3 ? (
                      <Medal size={18} className="medal-bronze" />
                    ) : (
                      <span>#{rank}</span>
                    )}
                  </div>
                  <div className="cell-name">
                    {p.nickname} {isPlayerMe && <span className="me-badge">(You)</span>}
                  </div>
                  <div className="cell-score">⭐ {p.score}</div>
                  <div className="cell-cleared">✔️ {p.boardsCleared}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="result-actions">
        <button onClick={requestRematch} className="btn btn-primary btn-large">
          <RotateCcw size={18} /> PLAY AGAIN
        </button>
        <button onClick={leaveRoom} className="btn btn-secondary btn-large">
          <Home size={18} /> EXIT TO LOBBY
        </button>
      </div>
    </div>
  );
}
