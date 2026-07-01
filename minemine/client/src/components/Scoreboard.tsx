import type { Player } from '../hooks/useSocket';
import { Trophy } from 'lucide-react';

interface ScoreboardProps {
  players: Player[];
  myId: string | undefined;
  otherPlayersProgress: Record<string, Partial<Player>>;
}

export function Scoreboard({ players, myId, otherPlayersProgress }: ScoreboardProps) {
  // Merge live score updates with static player info
  const livePlayers = players.map(p => {
    const live = otherPlayersProgress[p.id] || {};
    return {
      ...p,
      score: live.score ?? p.score,
      boardsCleared: live.boardsCleared ?? p.boardsCleared
    };
  });

  // Sort descending by score
  const sortedPlayers = [...livePlayers].sort((a, b) => b.score - a.score);

  return (
    <div className="scoreboard-card card glass-panel">
      <div className="scoreboard-header">
        <Trophy size={18} className="trophy-gold" />
        <h3>STANDINGS</h3>
      </div>

      <div className="scoreboard-rows">
        {sortedPlayers.map((p, index) => {
          const rank = index + 1;
          const isMe = p.id === myId;
          
          let rankClass = '';
          if (rank === 1) rankClass = 'rank-gold';
          else if (rank === 2) rankClass = 'rank-silver';
          else if (rank === 3) rankClass = 'rank-bronze';

          return (
            <div key={p.id} className={`scoreboard-row ${isMe ? 'is-me' : ''} ${rankClass}`}>
              <div className="row-left">
                <span className="player-rank">#{rank}</span>
                <span className="player-name">
                  {p.nickname} {isMe && <span className="me-label">(You)</span>}
                </span>
              </div>
              <div className="row-right">
                <span className="score-val">⭐ {p.score}</span>
                <span className="cleared-val">✔️ {p.boardsCleared}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
