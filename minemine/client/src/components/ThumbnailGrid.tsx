import { useEffect, useRef } from 'react';
import type { Player } from '../hooks/useSocket';

interface ThumbnailGridProps {
  players: Player[];
  myId: string | undefined;
  otherPlayersProgress: Record<string, Partial<Player>>;
}

interface PlayerCardProps {
  player: Player;
  progress: Partial<Player> | undefined;
  rank: number;
}

function PlayerThumbnailCard({ player, progress, rank }: PlayerCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const score = progress?.score ?? player.score;
  const boardsCleared = progress?.boardsCleared ?? player.boardsCleared;
  const boardState = progress?.boardState ?? player.boardState;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 90; // thumbnail width/height
    canvas.width = size;
    canvas.height = size;

    // Read colors dynamically from document body style (CSS variables)
    const bodyStyle = getComputedStyle(document.body);
    const cellBgClosed = bodyStyle.getPropertyValue('--cell-bg-closed').trim() || '#334155';
    const cellBgOpen = bodyStyle.getPropertyValue('--cell-bg-open').trim() || '#1e293b';
    const cellBgExploded = bodyStyle.getPropertyValue('--cell-bg-exploded').trim() || '#ef4444';
    const primaryColor = bodyStyle.getPropertyValue('--primary').trim() || '#f59e0b';

    // Draw background
    ctx.fillStyle = cellBgOpen;
    ctx.fillRect(0, 0, size, size);

    if (!boardState || !boardState.width || !boardState.height || !boardState.cells) {
      // Draw waiting placeholder
      ctx.fillStyle = cellBgClosed;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('NO DATA', size / 2, size / 2);
      return;
    }

    const { width, height, cells } = boardState;
    const cellW = size / width;
    const cellH = size / height;
    const gap = 0.5;

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const idx = r * width + c;
        const cellVal = cells[idx];
        const x = c * cellW + gap;
        const y = r * cellH + gap;
        const w = cellW - gap * 2;
        const h = cellH - gap * 2;

        // Choose color based on cell state:
        // 0 = unrevealed, 1 = revealed empty, 2 = flagged, 3 = exploded mine
        if (cellVal === 3) {
          ctx.fillStyle = cellBgExploded;
        } else if (cellVal === 2) {
          ctx.fillStyle = primaryColor;
        } else if (cellVal === 1) {
          ctx.fillStyle = cellBgOpen;
        } else {
          ctx.fillStyle = cellBgClosed;
        }

        ctx.fillRect(x, y, w, h);
      }
    }
  }, [boardState]);

  // Rank highlights: Gold, Silver, Bronze border colors
  let rankBorder = 'rgba(255, 255, 255, 0.1)';
  if (rank === 1) rankBorder = 'rgba(245, 158, 11, 0.8)'; // Gold glow
  if (rank === 2) rankBorder = 'rgba(148, 163, 184, 0.8)'; // Silver
  if (rank === 3) rankBorder = 'rgba(180, 83, 9, 0.8)'; // Bronze

  return (
    <div 
      className="opponent-card card" 
      style={{ borderColor: rankBorder, boxShadow: rank <= 3 ? `0 0 10px ${rankBorder}` : 'none' }}
    >
      <div className="opponent-header">
        <span className="opponent-name">
          {player.nickname.substring(0, 10)}
        </span>
        <span className="opponent-rank">#{rank}</span>
      </div>

      <div className="thumbnail-wrapper">
        <canvas ref={canvasRef} className="opponent-canvas" />
        {progress?.boardState?.cells?.some((c: number) => c === 3) && (
          <div className="opponent-dead-overlay">
            <span>BOOM!</span>
          </div>
        )}
      </div>

      <div className="opponent-stats">
        <span>⭐ {score}</span>
        <span>✔️ {boardsCleared}</span>
      </div>
    </div>
  );
}

export function ThumbnailGrid({ players, myId, otherPlayersProgress }: ThumbnailGridProps) {
  // Exclude myself from opponents view
  const opponents = players.filter(p => p.id !== myId);

  // Compute live scores for all players to determine rankings
  const rankedPlayers = [...players]
    .map(p => {
      const live = otherPlayersProgress[p.id] || {};
      return {
        ...p,
        score: live.score ?? p.score,
        boardsCleared: live.boardsCleared ?? p.boardsCleared
      };
    })
    .sort((a, b) => b.score - a.score);

  const getRank = (playerId: string): number => {
    return rankedPlayers.findIndex(p => p.id === playerId) + 1;
  };

  if (opponents.length === 0) {
    return (
      <div className="opponents-empty-state glass-container">
        <p>No other players in the game.</p>
        <span className="helper-hint">Invite friends to test the battle mode!</span>
      </div>
    );
  }

  return (
    <div className="opponents-grid-container">
      <div className="grid-header">
        <h3>BATTLEFIELD ({opponents.length})</h3>
      </div>
      <div className="opponents-grid">
        {opponents.map((p) => {
          const rank = getRank(p.id);
          return (
            <PlayerThumbnailCard
              key={p.id}
              player={p}
              progress={otherPlayersProgress[p.id]}
              rank={rank}
            />
          );
        })}
      </div>
    </div>
  );
}
