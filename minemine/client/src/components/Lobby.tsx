import { useState } from 'react';
import type { Room } from '../hooks/useSocket';
import { Play, Check, X, LogOut, Copy, Settings, Users, Clock, QrCode, Crown, CheckCircle2, AlertCircle } from 'lucide-react';

interface LobbyProps {
  room: Room | null;
  isConnected: boolean;
  error: string | null;
  myId: string | undefined;
  theme: 'retro' | 'minimal' | 'minemine';
  setTheme: (theme: 'retro' | 'minimal' | 'minemine') => void;
  createRoom: (nickname: string) => void;
  joinRoom: (roomId: string, nickname: string) => void;
  leaveRoom: () => void;
  setReady: (isReady: boolean) => void;
  updateConfig: (config: { timeLimit?: number; maxPlayers?: number }) => void;
  startGame: () => void;
  setError: (err: string | null) => void;
}

export function Lobby({
  room,
  isConnected,
  error,
  myId,
  theme,
  setTheme,
  createRoom,
  joinRoom,
  leaveRoom,
  setReady,
  updateConfig,
  startGame,
  setError
}: LobbyProps) {
  const [nickname, setNickname] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room')?.toUpperCase() || '';
  });
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) {
      setError('Please enter a nickname.');
      return;
    }
    createRoom(nickname.trim());
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) {
      setError('Please enter a nickname.');
      return;
    }
    if (!roomCodeInput.trim()) {
      setError('Please enter a room code.');
      return;
    }
    joinRoom(roomCodeInput.trim().toUpperCase(), nickname.trim());
  };

  const inviteLink = room 
    ? `${window.location.origin}/?room=${room.id}` 
    : '';

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(() => {
          console.log('Copied successfully using navigator.clipboard');
        })
        .catch((err) => {
          console.warn('navigator.clipboard failed, attempting fallback: ', err);
          fallbackCopyText(text);
        });
    } else {
      fallbackCopyText(text);
    }
  };

  const fallbackCopyText = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    
    // Prevent zoom and keyboard layout changes on mobile
    textArea.style.fontSize = '12pt';
    textArea.style.position = 'absolute';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    textArea.setAttribute('readonly', '');
    
    document.body.appendChild(textArea);
    
    const isIOS = navigator.userAgent.match(/ipad|iphone/i);
    if (isIOS) {
      const range = document.createRange();
      range.selectNodeContents(textArea);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      textArea.setSelectionRange(0, 999999);
    } else {
      textArea.focus();
      textArea.select();
    }
    
    try {
      const successful = document.execCommand('copy');
      if (!successful) {
        console.error('execCommand copy returned false');
      }
    } catch (err) {
      console.error('Fallback copy failed: ', err);
    }
    
    document.body.removeChild(textArea);
  };

  const handleCopyCode = () => {
    if (!room) return;
    copyToClipboard(room.id);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    copyToClipboard(inviteLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  if (!room) {
    // ROOM JOIN / CREATE FORM
    return (
      <div className="lobby-container glass-container">
        <h1 className="logo">MINEMINE {theme === 'minemine' && '🐦'}</h1>


        <div className="theme-picker-container">
          <span className="theme-label">Select Theme</span>
          <div className="theme-buttons">
            <button onClick={() => setTheme('retro')} className={`btn-theme-select ${theme === 'retro' ? 'active' : ''}`}>RETRO</button>
            <button onClick={() => setTheme('minimal')} className={`btn-theme-select ${theme === 'minimal' ? 'active' : ''}`}>MINIMAL</button>
            <button onClick={() => setTheme('minemine')} className={`btn-theme-select ${theme === 'minemine' ? 'active' : ''}`}>MINEMINE</button>
          </div>
        </div>

        <div className="card">
          <form className="form-group">
            <label htmlFor="nickname">Nickname</label>
            <input
              id="nickname"
              type="text"
              placeholder="Enter your name"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={12}
            />
          </form>

          {error && (
            <div className="alert alert-error">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="action-grid">
            <button onClick={handleCreate} className="btn btn-primary btn-large">
              Create Game Room
            </button>
            
            <div className="divider"><span>OR JOIN ROOM</span></div>

            <form onSubmit={handleJoin} className="join-form">
              <input
                type="text"
                placeholder="ROOM CODE"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value)}
                maxLength={6}
                className="room-code-input"
              />
              <button type="submit" className="btn btn-secondary">
                Join
              </button>
            </form>
          </div>
        </div>

        <div className="connection-status">
          <span className={`status-dot ${isConnected ? 'online' : 'offline'}`}></span>
          <span>{isConnected ? 'Connected to Server' : 'Connecting to Server...'}</span>
        </div>
      </div>
    );
  }

  // WAITING ROOM LOBBY
  const isHost = room.hostId === myId;
  const me = room.players.find(p => p.id === myId);
  const myReady = me?.isReady || false;
  
  // Start check: host does not count as needing to click ready, but everyone else must be ready
  const otherPlayers = room.players.filter(p => p.id !== room.hostId);
  const canStart = otherPlayers.length > 0 && otherPlayers.every(p => p.isReady);

  return (
    <div className="lobby-container glass-container lobby-waiting-room">
      <div className="lobby-header">
        <div>
          <span className="room-label">ROOM CODE</span>
          <h2 className="room-id" onClick={handleCopyCode} style={{ cursor: 'pointer' }} title="Click to copy room code">
            {room.id}{' '}
            <span style={{ marginLeft: '6px', fontSize: '0.8rem', verticalAlign: 'middle', color: copiedCode ? 'var(--primary)' : 'inherit', transition: 'all 0.2s' }}>
              {copiedCode ? 'Copied!' : <Copy size={16} className="inline-icon click-icon" />}
            </span>
          </h2>
        </div>
        <div className="lobby-header-actions">
          <button onClick={() => setShowQR(!showQR)} className="btn btn-icon" title="Show QR Code">
            <QrCode size={20} />
          </button>
          <button onClick={handleCopyLink} className="btn btn-secondary">
            {copiedLink ? 'Copied!' : 'Copy Invite Link'}
          </button>
          <button onClick={leaveRoom} className="btn btn-danger btn-icon" title="Leave Room">
            <LogOut size={20} />
          </button>
        </div>
      </div>

      {showQR && (
        <div className="qr-container card animated fadeIn">
          <h3>Scan to Join Game</h3>
          <img 
            src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(inviteLink)}`} 
            alt="QR Code" 
          />
          <p className="qr-link">{inviteLink}</p>
        </div>
      )}

      <div className="lobby-grid">
        {/* PLAYER LIST */}
        <div className="player-list-card card">
          <div className="card-header">
            <Users size={18} />
            <h3>Players ({room.players.length}/{room.config.maxPlayers})</h3>
          </div>
          
          <div className="player-list">
            {room.players.map((p) => {
              const isPlayerHost = room.hostId === p.id;
              const isMe = p.id === myId;
              return (
                <div key={p.id} className={`player-row ${isMe ? 'is-me' : ''}`}>
                  <div className="player-info">
                    {isPlayerHost ? (
                      <Crown size={16} className="host-crown-icon" />
                    ) : (
                      <span className="player-bullet"></span>
                    )}
                    <span className="player-name">
                      {p.nickname} {isMe && <span className="me-badge">(You)</span>}
                    </span>
                  </div>
                  <div className="player-status">
                    {isPlayerHost ? (
                      <span className="badge badge-host">HOST</span>
                    ) : p.isReady ? (
                      <span className="badge badge-ready">
                        <Check size={12} /> READY
                      </span>
                    ) : (
                      <span className="badge badge-waiting">
                        <Clock size={12} /> WAITING
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SETTINGS CARD */}
        <div className="settings-card card">
          <div className="card-header">
            <Settings size={18} />
            <h3>Game Settings</h3>
          </div>

          <div className="settings-form">
            <div className="setting-row">
              <label>
                <Clock size={16} /> Time Limit
              </label>
              {isHost ? (
                <select
                  value={room.config.timeLimit}
                  onChange={(e) => updateConfig({ timeLimit: parseInt(e.target.value, 10) })}
                >
                  <option value={60}>60 Seconds</option>
                  <option value={120}>120 Seconds (2 min)</option>
                  <option value={180}>180 Seconds (3 min)</option>
                  <option value={300}>300 Seconds (5 min)</option>
                </select>
              ) : (
                <span className="setting-val">{room.config.timeLimit}s</span>
              )}
            </div>

            <div className="setting-row">
              <label>
                <Users size={16} /> Max Players
              </label>
              {isHost ? (
                <input
                  type="number"
                  min={2}
                  max={99}
                  value={room.config.maxPlayers}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) {
                      const boundedVal = Math.max(2, Math.min(99, val));
                      updateConfig({ maxPlayers: boundedVal });
                    }
                  }}
                  className="settings-number-input"
                />
              ) : (
                <span className="setting-val">{room.config.maxPlayers} Players</span>
              )}
            </div>
          </div>

          <div className="lobby-actions">
            {isHost ? (
              <button
                onClick={startGame}
                disabled={!canStart}
                className={`btn btn-primary btn-large btn-full ${!canStart ? 'btn-disabled' : ''}`}
              >
                <Play size={18} /> START GAME
              </button>
            ) : (
              <button
                onClick={() => setReady(!myReady)}
                className={`btn btn-large btn-full ${myReady ? 'btn-secondary' : 'btn-primary'}`}
              >
                {myReady ? <X size={18} /> : <CheckCircle2 size={18} />}
                {myReady ? 'CANCEL READY' : 'READY TO PLAY'}
              </button>
            )}
            {isHost && !canStart && (
              <p className="host-hint">
                {room.players.length === 1 
                  ? 'Waiting for other players to join...' 
                  : 'All players must click READY to start.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
