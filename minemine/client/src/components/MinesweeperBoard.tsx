import { useRef, useEffect, useState } from 'react';
import type { MouseEvent, TouchEvent } from 'react';
import type { Cell, GameStatus } from '../hooks/useMinesweeper';
import { Flag, ShieldAlert, Award } from 'lucide-react';

interface MinesweeperBoardProps {
  board: Cell[][];
  gameState: GameStatus;
  size: number;
  level: number;
  score: number;
  currentBoardScore: number;
  boardsCleared: number;
  penaltyActive: boolean;
  penaltyTimeLeft: number;
  revealCell: (r: number, c: number) => void;
  toggleFlag: (r: number, c: number) => void;
  chordCell: (r: number, c: number) => void;
}

export function MinesweeperBoard({
  board,
  gameState,
  size,
  level,
  score,
  currentBoardScore,
  boardsCleared,
  penaltyActive,
  penaltyTimeLeft,
  revealCell,
  toggleFlag,
  chordCell
}: MinesweeperBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredCell, setHoveredCell] = useState<{ r: number; c: number } | null>(null);
  const [touchMode, setTouchMode] = useState<'reveal' | 'flag'>('reveal'); // For mobile tap override
  const longPressTimeout = useRef<number | null>(null);
  const isTouchActive = useRef<boolean>(false);



  // Draw board onto Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get current client layout size
    const container = containerRef.current;
    if (!container) return;

    const displayWidth = container.clientWidth;
    const displayHeight = container.clientHeight || displayWidth;
    const canvasSize = Math.min(displayWidth, displayHeight);

    // Set canvas dimensions with high-DPI scaling support
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    canvas.style.width = `${canvasSize}px`;
    canvas.style.height = `${canvasSize}px`;

    ctx.scale(dpr, dpr);

    // Fetch theme colors dynamically from the document style
    const bodyStyle = getComputedStyle(document.body);
    const cellBgClosed = bodyStyle.getPropertyValue('--cell-bg-closed').trim() || '#1e293b';
    const cellBgOpen = bodyStyle.getPropertyValue('--cell-bg-open').trim() || '#0f172a';
    const cellBgHover = bodyStyle.getPropertyValue('--cell-bg-hover').trim() || '#334155';
    const cellBgExploded = bodyStyle.getPropertyValue('--cell-bg-exploded').trim() || '#ef4444';
    const dangerColor = bodyStyle.getPropertyValue('--danger').trim() || '#ef4444';
    const fontName = bodyStyle.getPropertyValue('--font-sans').trim() || 'Outfit, Inter, sans-serif';

    const numColors = [
      '',
      bodyStyle.getPropertyValue('--cell-fg-1').trim() || '#3b82f6',
      bodyStyle.getPropertyValue('--cell-fg-2').trim() || '#10b981',
      bodyStyle.getPropertyValue('--cell-fg-3').trim() || '#ef4444',
      bodyStyle.getPropertyValue('--cell-fg-4').trim() || '#8b5cf6',
      bodyStyle.getPropertyValue('--cell-fg-5').trim() || '#f59e0b',
      bodyStyle.getPropertyValue('--cell-fg-6').trim() || '#06b6d4',
      bodyStyle.getPropertyValue('--cell-fg-7').trim() || '#ec4899',
      bodyStyle.getPropertyValue('--cell-fg-8').trim() || '#64748b'
    ];

    // Render configuration
    const padding = 2; // spacing around board
    const boardArea = canvasSize - padding * 2;
    const cellSize = boardArea / size;
    const cellGap = 1.5;

    // Draw board background
    ctx.fillStyle = cellBgOpen;
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // Draw cells
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = board[r]?.[c];
        if (!cell) continue;

        const x = padding + c * cellSize + cellGap;
        const y = padding + r * cellSize + cellGap;
        const w = cellSize - cellGap * 2;
        const h = cellSize - cellGap * 2;
        const radius = Math.max(2, cellSize * 0.1); // rounded corners based on cell size

        // Determine background color
        let isHovered = hoveredCell && hoveredCell.r === r && hoveredCell.c === c;
        let cellColor = cellBgClosed;

        if (cell.isRevealed) {
          if (cell.isMine) {
            cellColor = cellBgExploded;
          } else {
            cellColor = cellBgOpen;
          }
        } else {
          // Closed cells
          if (isHovered && !penaltyActive && gameState !== 'exploded') {
            cellColor = cellBgHover;
          } else {
            cellColor = cellBgClosed;
          }
        }

        // Draw cell background (rounded rectangle helper)
        ctx.fillStyle = cellColor;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, radius);
        ctx.fill();

        // Draw border if cell is hovered or revealed
        if (cell.isRevealed) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          // Glow border for flags
          if (cell.isFlagged) {
            ctx.strokeStyle = dangerColor;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          } else {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        // Draw cell content
        if (cell.isRevealed) {
          if (cell.isMine) {
            // Draw Mine Symbol (Sphere + Spikes)
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(x + w / 2, y + h / 2, w * 0.25, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw small cross lines for spikes
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            
            ctx.beginPath();
            ctx.moveTo(x + w * 0.2, y + h / 2);
            ctx.lineTo(x + w * 0.8, y + h / 2);
            ctx.moveTo(x + w / 2, y + h * 0.2);
            ctx.lineTo(x + w / 2, y + h * 0.8);
            ctx.stroke();
          } else if (cell.neighborMines > 0) {
            // Draw adjacent mine count
            ctx.fillStyle = numColors[cell.neighborMines] || '#ffffff';
            ctx.font = `bold ${Math.floor(cellSize * 0.5)}px ${fontName}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(cell.neighborMines.toString(), x + w / 2, y + h / 2 + 1);
          }
        } else if (cell.isFlagged) {
          // Draw Flag Icon (Pole + Red Triangle)
          ctx.fillStyle = dangerColor; // Red flag
          ctx.beginPath();
          ctx.moveTo(x + w * 0.35, y + h * 0.25);
          ctx.lineTo(x + w * 0.7, y + h * 0.4);
          ctx.lineTo(x + w * 0.35, y + h * 0.55);
          ctx.closePath();
          ctx.fill();

          // Flag Pole
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x + w * 0.35, y + h * 0.2);
          ctx.lineTo(x + w * 0.35, y + h * 0.8);
          ctx.stroke();

          // Flag base line
          ctx.beginPath();
          ctx.moveTo(x + w * 0.25, y + h * 0.8);
          ctx.lineTo(x + w * 0.5, y + h * 0.8);
          ctx.stroke();
        }
      }
    }
  }, [board, size, hoveredCell, penaltyActive, gameState]);

  // Translate click screen coordinates to row/col index
  const getCellFromEvent = (e: MouseEvent<HTMLCanvasElement>): { r: number; c: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const canvasSize = rect.width;
    const padding = 2;
    const boardArea = canvasSize - padding * 2;
    const cellSize = boardArea / size;

    const c = Math.floor((x - padding) / cellSize);
    const r = Math.floor((y - padding) / cellSize);

    if (r >= 0 && r < size && c >= 0 && c < size) {
      return { r, c };
    }
    return null;
  };

  const getCellFromTouch = (e: TouchEvent<HTMLCanvasElement>): { r: number; c: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas || e.touches.length === 0) return null;

    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    const canvasSize = rect.width;
    const padding = 2;
    const boardArea = canvasSize - padding * 2;
    const cellSize = boardArea / size;

    const c = Math.floor((x - padding) / cellSize);
    const r = Math.floor((y - padding) / cellSize);

    if (r >= 0 && r < size && c >= 0 && c < size) {
      return { r, c };
    }
    return null;
  };

  // Mouse handlers
  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (isTouchActive.current) return; // Prevent double-trigger on mobile mouse emulation
    const cell = getCellFromEvent(e);
    setHoveredCell(cell);
  };

  const handleMouseLeave = () => {
    setHoveredCell(null);
  };

  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    if (isTouchActive.current) return;
    if (e.button === 2) {
      // Right click: toggle flag
      e.preventDefault();
      const cell = getCellFromEvent(e);
      if (cell) toggleFlag(cell.r, cell.c);
    }
  };

  const handleMouseUp = (e: MouseEvent<HTMLCanvasElement>) => {
    if (isTouchActive.current) return;
    if (e.button === 0) {
      // Left click
      const cell = getCellFromEvent(e);
      if (cell) {
        const clickedCell = board[cell.r]?.[cell.c];
        if (clickedCell && clickedCell.isRevealed) {
          // Clicked already opened cell -> chord
          chordCell(cell.r, cell.c);
        } else {
          revealCell(cell.r, cell.c);
        }
      }
    }
  };

  const handleContextMenu = (e: MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault(); // disable default context menu
  };

  // Touch handlers (for Mobile layout)
  const handleTouchStart = (e: TouchEvent<HTMLCanvasElement>) => {
    isTouchActive.current = true;
    const cell = getCellFromTouch(e);
    if (!cell) return;

    setHoveredCell(cell);

    // Setup long press for flagging
    if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
    longPressTimeout.current = window.setTimeout(() => {
      toggleFlag(cell.r, cell.c);
      if (longPressTimeout.current) {
        clearTimeout(longPressTimeout.current);
        longPressTimeout.current = null;
      }
    }, 500); // 500ms long press to flag
  };

  const handleTouchEnd = () => {
    if (longPressTimeout.current) {
      // It was a short tap
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;

      const cell = hoveredCell;
      if (cell) {
        if (touchMode === 'flag') {
          toggleFlag(cell.r, cell.c);
        } else {
          const clickedCell = board[cell.r]?.[cell.c];
          if (clickedCell && clickedCell.isRevealed) {
            chordCell(cell.r, cell.c);
          } else {
            revealCell(cell.r, cell.c);
          }
        }
      }
    }
    setHoveredCell(null);
  };

  return (
    <div className="minesweeper-board-wrapper">
      {/* HUD Info */}
      <div className="board-hud">
        <div className="hud-metric">
          <span className="hud-label">LEVEL</span>
          <span className="hud-value color-gradient-text">{level}</span>
        </div>
        <div className="hud-metric">
          <span className="hud-label">TOTAL SCORE</span>
          <span className="hud-value font-mono">{score}</span>
        </div>
        <div className="hud-metric">
          <span className="hud-label">BOARD SCORE</span>
          <span className="hud-value font-mono">{currentBoardScore}</span>
        </div>
        <div className="hud-metric">
          <span className="hud-label">CLEARED</span>
          <span className="hud-value font-mono">{boardsCleared}</span>
        </div>
      </div>

      {/* Main Canvas Box */}
      <div ref={containerRef} className="board-canvas-container">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className={`game-canvas ${penaltyActive ? 'shake' : ''}`}
        />

        {/* Penalty Cooldown Overlay */}
        {penaltyActive && (
          <div className="board-overlay penalty-overlay animated fadeIn">
            <ShieldAlert size={48} className="overlay-icon alert-pulse" />
            <h3 className="overlay-title">SYSTEM DETECTED MINE!</h3>
            <p className="overlay-desc">Locked out for {penaltyTimeLeft}s</p>
            <div className="penalty-bar-container">
              <div 
                className="penalty-bar-fill" 
                style={{ width: `${(penaltyTimeLeft / 3) * 100}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Level cleared transition overlay */}
        {gameState === 'cleared' && (
          <div className="board-overlay success-overlay animated fadeIn">
            <Award size={48} className="overlay-icon gold-spin" />
            <h3 className="overlay-title">BOARD CLEARED!</h3>
            <p className="overlay-desc">Preparing Level {level + 1}...</p>
          </div>
        )}
      </div>

      {/* Mobile Touch Mode Controller */}
      <div className="touch-mode-selector">
        <button
          onClick={() => setTouchMode('reveal')}
          className={`btn btn-touch ${touchMode === 'reveal' ? 'active-reveal' : ''}`}
        >
          ⛏️ Dig Cell
        </button>
        <button
          onClick={() => setTouchMode('flag')}
          className={`btn btn-touch ${touchMode === 'flag' ? 'active-flag' : ''}`}
        >
          <Flag size={14} className="inline-icon" /> Flag Mine
        </button>
      </div>
      <p className="helper-hint">
        💡 PC: Left-Click to open, Right-Click to flag. Double click numbers to Chord.
      </p>
    </div>
  );
}
