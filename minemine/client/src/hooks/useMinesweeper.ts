import { useState, useCallback } from 'react';

export interface Cell {
  r: number;
  c: number;
  isMine: boolean;
  isRevealed: boolean;
  isFlagged: boolean;
  neighborMines: number;
}

export type GameStatus = 'idle' | 'playing' | 'cleared' | 'exploded';

// Configuration for levels
const LEVEL_CONFIGS = [
  { level: 1, size: 9, mines: 10 },
  { level: 2, size: 12, mines: 18 },
  { level: 3, size: 16, mines: 40 },
  { level: 4, size: 20, mines: 70 },
  { level: 5, size: 24, mines: 110 },
  { level: 6, size: 28, mines: 155 },
  { level: 7, size: 30, mines: 180 }
];

export function useMinesweeper(onStateChange?: (score: number, boardsCleared: number, boardState: any) => void) {
  const [level, setLevel] = useState(1);
  const [board, setBoard] = useState<Cell[][]>([]);
  const [gameState, setGameState] = useState<GameStatus>('idle');
  const [totalScore, setTotalScore] = useState(0);
  const [currentBoardScore, setCurrentBoardScore] = useState(0);
  const [boardsCleared, setBoardsCleared] = useState(0);
  const [isFirstClick, setIsFirstClick] = useState(true);
  const [penaltyActive, setPenaltyActive] = useState(false);
  const [penaltyTimeLeft, setPenaltyTimeLeft] = useState(0);

  const currentConfig = LEVEL_CONFIGS[Math.min(level - 1, LEVEL_CONFIGS.length - 1)];
  const { size, mines } = currentConfig;

  // Generate blank board
  const generateBlankBoard = useCallback((gridSize: number): Cell[][] => {
    const newBoard: Cell[][] = [];
    for (let r = 0; r < gridSize; r++) {
      const row: Cell[] = [];
      for (let c = 0; c < gridSize; c++) {
        row.push({
          r,
          c,
          isMine: false,
          isRevealed: false,
          isFlagged: false,
          neighborMines: 0
        });
      }
      newBoard.push(row);
    }
    return newBoard;
  }, []);

  // Initialize/Reset game
  const resetGame = useCallback((nextLevel = 1, keepScore = false) => {
    setLevel(nextLevel);
    const targetConfig = LEVEL_CONFIGS[Math.min(nextLevel - 1, LEVEL_CONFIGS.length - 1)];
    const newBoard = generateBlankBoard(targetConfig.size);
    setBoard(newBoard);
    setGameState('idle');
    setIsFirstClick(true);
    setPenaltyActive(false);
    setPenaltyTimeLeft(0);
    if (!keepScore) {
      setTotalScore(0);
      setBoardsCleared(0);
    }
    setCurrentBoardScore(0);
  }, [generateBlankBoard]);

  // Generate simple board state representation for multiplayer thumbnails
  const getThumbnailState = useCallback((grid: Cell[][]) => {
    if (grid.length === 0) return null;
    const width = grid[0].length;
    const height = grid.length;
    // Map cells: 0 = unrevealed, 1 = revealed empty, 2 = flagged, 3 = exploded mine
    const cells = grid.flat().map(cell => {
      if (cell.isRevealed) {
        return cell.isMine ? 3 : 1;
      }
      return cell.isFlagged ? 2 : 0;
    });

    return { width, height, cells };
  }, []);

  // Safe wrapper for triggering callback updates to the server
  const triggerStateUpdate = useCallback((newScore: number, newCleared: number, newBoard: Cell[][]) => {
    if (onStateChange) {
      const thumb = getThumbnailState(newBoard);
      onStateChange(newScore, newCleared, thumb);
    }
  }, [onStateChange, getThumbnailState]);

  // Generate mines on first click, avoiding the clicked cell and its neighbors
  const placeMines = useCallback((grid: Cell[][], startRow: number, startCol: number, totalMines: number) => {
    const gridSize = grid.length;
    let minesPlaced = 0;

    while (minesPlaced < totalMines) {
      const r = Math.floor(Math.random() * gridSize);
      const c = Math.floor(Math.random() * gridSize);

      // Check if candidate cell is the clicked cell or in its 3x3 surrounding area
      const isStartArea = Math.abs(r - startRow) <= 1 && Math.abs(c - startCol) <= 1;

      if (!grid[r][c].isMine && !isStartArea) {
        grid[r][c].isMine = true;
        minesPlaced++;
      }
    }

    // Calculate neighbors
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (grid[r][c].isMine) continue;
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize) {
              if (grid[nr][nc].isMine) count++;
            }
          }
        }
        grid[r][c].neighborMines = count;
      }
    }
  }, []);

  // Flood fill algorithm to open empty cells
  const revealCellRecursive = useCallback((grid: Cell[][], r: number, c: number) => {
    const gridSize = grid.length;
    const cell = grid[r][c];
    if (cell.isRevealed || cell.isFlagged || cell.isMine) return;

    cell.isRevealed = true;

    if (cell.neighborMines === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize) {
            revealCellRecursive(grid, nr, nc);
          }
        }
      }
    }
  }, []);

  // Check if the board is fully cleared
  const checkWinCondition = useCallback((grid: Cell[][]): boolean => {
    return grid.every(row => 
      row.every(cell => cell.isMine || cell.isRevealed)
    );
  }, []);

  // Handle clicking a cell (Left Click)
  const revealCell = useCallback((row: number, col: number) => {
    if (gameState === 'exploded' || gameState === 'cleared' || penaltyActive) return;

    const newBoard = board.map(r => r.map(c => ({ ...c })));
    let currentIsFirst = isFirstClick;
    let nextTotalScore = totalScore;
    let nextBoardScore = currentBoardScore;
    let nextCleared = boardsCleared;

    if (currentIsFirst) {
      placeMines(newBoard, row, col, mines);
      setIsFirstClick(false);
      currentIsFirst = false;
      setGameState('playing');
    }

    const cell = newBoard[row][col];
    if (cell.isRevealed || cell.isFlagged) return;

    if (cell.isMine) {
      // Exploded
      cell.isRevealed = true;
      setGameState('exploded');

      // Exploded: Reset current board score to 0
      nextBoardScore = 0;
      setCurrentBoardScore(0);

      // Penalty active: block play for 3 seconds
      setPenaltyActive(true);
      setPenaltyTimeLeft(3);
      
      const interval = setInterval(() => {
        setPenaltyTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            setPenaltyActive(false);
            // Reset to clean board of the same level
            resetGame(level, true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

    } else {
      // Safe reveal
      revealCellRecursive(newBoard, row, col);

      // Count newly revealed cells
      const cellsBefore = board.flat().filter(c => c.isRevealed).length;
      const cellsAfter = newBoard.flat().filter(c => c.isRevealed).length;
      const cellsOpened = cellsAfter - cellsBefore;

      nextBoardScore = currentBoardScore + cellsOpened;
      setCurrentBoardScore(nextBoardScore);

      // Check win
      if (checkWinCondition(newBoard)) {
        setGameState('cleared');

        // Score formulas: Level multiplier * 150 points
        const clearBonus = level * 150;
        nextTotalScore = totalScore + nextBoardScore + clearBonus;
        setTotalScore(nextTotalScore);
        
        nextCleared = boardsCleared + 1;
        setBoardsCleared(nextCleared);

        // Advance level after slight delay for visual satisfaction
        setTimeout(() => {
          const nextLvl = level + 1;
          setLevel(nextLvl);
          resetGame(nextLvl, true);
        }, 800);
      }
    }

    setBoard(newBoard);
    const liveScore = (checkWinCondition(newBoard) && !cell.isMine) ? nextTotalScore : (totalScore + nextBoardScore);
    triggerStateUpdate(liveScore, nextCleared, newBoard);
  }, [board, gameState, isFirstClick, level, mines, totalScore, currentBoardScore, boardsCleared, penaltyActive, placeMines, revealCellRecursive, checkWinCondition, resetGame, triggerStateUpdate]);

  // Handle Flagging a Cell (Right Click / Long Press)
  const toggleFlag = useCallback((row: number, col: number) => {
    if (gameState === 'exploded' || gameState === 'cleared' || penaltyActive) return;

    const newBoard = board.map(r => r.map(c => ({ ...c })));
    const cell = newBoard[row][col];
    
    if (cell.isRevealed) return;

    cell.isFlagged = !cell.isFlagged;
    setBoard(newBoard);
    triggerStateUpdate(totalScore + currentBoardScore, boardsCleared, newBoard);
  }, [board, gameState, totalScore, currentBoardScore, boardsCleared, penaltyActive, triggerStateUpdate]);

  // Handle Chord (Double Click or clicking revealed number)
  const chordCell = useCallback((row: number, col: number) => {
    if (gameState === 'exploded' || gameState === 'cleared' || penaltyActive) return;

    const cell = board[row][col];
    if (!cell.isRevealed || cell.neighborMines === 0) return;

    const gridSize = board.length;
    // Count surrounding flags
    let flaggedCount = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize) {
          if (board[nr][nc].isFlagged) flaggedCount++;
        }
      }
    }

    // If flagged count matches neighbor mines, reveal all unflagged neighbors
    if (flaggedCount === cell.neighborMines) {
      let hitMine = false;
      let mineR = -1;
      let mineC = -1;
      const newBoard = board.map(r => r.map(c => ({ ...c })));

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = row + dr;
          const nc = col + dc;
          if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize) {
            const neighbor = newBoard[nr][nc];
            if (!neighbor.isRevealed && !neighbor.isFlagged) {
              if (neighbor.isMine) {
                hitMine = true;
                mineR = nr;
                mineC = nc;
              } else {
                revealCellRecursive(newBoard, nr, nc);
              }
            }
          }
        }
      }

      let nextTotalScore = totalScore;
      let nextBoardScore = currentBoardScore;
      let nextCleared = boardsCleared;

      if (hitMine) {
        newBoard[mineR][mineC].isRevealed = true;
        setGameState('exploded');
        
        // Reset current board score
        nextBoardScore = 0;
        setCurrentBoardScore(0);

        setPenaltyActive(true);
        setPenaltyTimeLeft(3);
        const interval = setInterval(() => {
          setPenaltyTimeLeft(prev => {
            if (prev <= 1) {
              clearInterval(interval);
              setPenaltyActive(false);
              resetGame(level, true);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        // Count newly revealed cells
        const cellsBefore = board.flat().filter(c => c.isRevealed).length;
        const cellsAfter = newBoard.flat().filter(c => c.isRevealed).length;
        const cellsOpened = cellsAfter - cellsBefore;

        nextBoardScore = currentBoardScore + cellsOpened;
        setCurrentBoardScore(nextBoardScore);

        if (checkWinCondition(newBoard)) {
          setGameState('cleared');
          const clearBonus = level * 150;
          
          nextTotalScore = totalScore + nextBoardScore + clearBonus;
          setTotalScore(nextTotalScore);
          
          nextCleared = boardsCleared + 1;
          setBoardsCleared(nextCleared);

          setTimeout(() => {
            const nextLvl = level + 1;
            setLevel(nextLvl);
            resetGame(nextLvl, true);
          }, 800);
        }
      }

      setBoard(newBoard);
      const liveScore = (checkWinCondition(newBoard) && !hitMine) ? nextTotalScore : (totalScore + nextBoardScore);
      triggerStateUpdate(liveScore, nextCleared, newBoard);
    }
  }, [board, gameState, level, totalScore, currentBoardScore, boardsCleared, penaltyActive, revealCellRecursive, checkWinCondition, resetGame, triggerStateUpdate]);

  return {
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
  };
}
