import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Music } from 'lucide-react';

interface BgmControllerProps {
  isGameActive: boolean;
}

export function BgmController({ isGameActive }: BgmControllerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(() => {
    const savedMute = localStorage.getItem('bgm_muted');
    return savedMute === 'true';
  });
  const [volume, setVolume] = useState(() => {
    const savedVol = localStorage.getItem('bgm_volume');
    return savedVol ? parseFloat(savedVol) : 0.3; // Default 30% volume
  });
  const [isHovered, setIsHovered] = useState(false);

  // Initialize Audio
  useEffect(() => {
    const audio = new Audio('/bgm.mp3');
    audio.loop = true;
    audio.volume = isMuted ? 0 : volume;
    audioRef.current = audio;

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  // Sync mute & volume states
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
    localStorage.setItem('bgm_muted', String(isMuted));
    localStorage.setItem('bgm_volume', String(volume));
  }, [isMuted, volume]);

  // Handle active game transitions (Lobby vs Active Game)
  useEffect(() => {
    if (!audioRef.current) return;

    if (isGameActive) {
      if (!isMuted) {
        audioRef.current.play()
          .then(() => setIsPlaying(true))
          .catch((err) => console.log('Autoplay blocked or play failed:', err));
      }
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [isGameActive, isMuted]);

  const handleTogglePlay = () => {
    if (!audioRef.current || !isGameActive) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play()
        .then(() => {
          setIsPlaying(true);
          setIsMuted(false); // Unmute on explicit play
        })
        .catch((err) => console.log('Playback error:', err));
    }
  };

  const handleToggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioRef.current) return;

    if (isMuted) {
      setIsMuted(false);
      if (isGameActive && !isPlaying) {
        audioRef.current.play()
          .then(() => setIsPlaying(true))
          .catch((err) => console.log('Playback error:', err));
      }
    } else {
      setIsMuted(true);
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVol = parseFloat(e.target.value);
    setVolume(nextVol);
    if (!audioRef.current) return;

    if (nextVol > 0 && isMuted) {
      setIsMuted(false);
      if (isGameActive && !isPlaying) {
        audioRef.current.play()
          .then(() => setIsPlaying(true))
          .catch((err) => console.log('Playback error:', err));
      }
    }
  };

  return (
    <div 
      className={`bgm-widget-container ${isHovered ? 'expanded' : ''} ${isPlaying && !isMuted ? 'active' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ opacity: isGameActive ? 1 : 0.6, cursor: isGameActive ? 'pointer' : 'default' }}
    >
      <button 
        onClick={handleTogglePlay} 
        className={`bgm-btn bgm-main-btn ${isPlaying && !isMuted ? 'playing' : ''}`}
        title={isGameActive ? (isPlaying ? 'Pause BGM' : 'Play BGM') : 'BGM plays when game starts'}
        disabled={!isGameActive}
      >
        <Music className="bgm-icon-music" size={16} />
      </button>

      <div className="bgm-slider-drawer">
        <button 
          onClick={handleToggleMute} 
          className="bgm-btn bgm-mute-btn"
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>

        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.05" 
          value={isMuted ? 0 : volume} 
          onChange={handleVolumeChange}
          className="bgm-volume-slider"
        />
      </div>
    </div>
  );
}
