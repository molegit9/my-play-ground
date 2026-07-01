import { useRef } from 'react';

interface ThemeBackgroundsProps {
  theme: 'retro' | 'minimal' | 'minemine';
}

export function ThemeBackgrounds({ theme }: ThemeBackgroundsProps) {
  // Generate a random delay between 0 and -90 seconds so the day/night cycle starts at a random phase
  const randomDelayRef = useRef(`${(Math.random() * -90).toFixed(2)}s`);

  if (theme === 'retro') {
    return (
      <div className="retro-bg-container" aria-hidden="true">
        {/* Matrix rain falling streams */}
        <div className="matrix-rain">
          <div className="matrix-line" style={{ left: '4%', animationDelay: '0s', animationDuration: '3.8s' }}></div>
          <div className="matrix-line" style={{ left: '12%', animationDelay: '1.2s', animationDuration: '5.2s' }}></div>
          <div className="matrix-line" style={{ left: '22%', animationDelay: '0.4s', animationDuration: '4.5s' }}></div>
          <div className="matrix-line" style={{ left: '32%', animationDelay: '2.2s', animationDuration: '6s' }}></div>
          <div className="matrix-line" style={{ left: '42%', animationDelay: '0.8s', animationDuration: '4s' }}></div>
          <div className="matrix-line" style={{ left: '52%', animationDelay: '3.1s', animationDuration: '5.8s' }}></div>
          <div className="matrix-line" style={{ left: '62%', animationDelay: '0.2s', animationDuration: '4.8s' }}></div>
          <div className="matrix-line" style={{ left: '72%', animationDelay: '1.8s', animationDuration: '7s' }}></div>
          <div className="matrix-line" style={{ left: '82%', animationDelay: '1s', animationDuration: '4.2s' }}></div>
          <div className="matrix-line" style={{ left: '92%', animationDelay: '0.6s', animationDuration: '3.5s' }}></div>
        </div>
        {/* CRT Scanline Overlay */}
        <div className="crt-scanlines"></div>
        {/* CRT Glitch Overlay */}
        <div className="crt-glitch"></div>
      </div>
    );
  }

  if (theme === 'minimal') {
    return (
      <div className="minimal-bg-container" aria-hidden="true">
        {/* Outline shapes floating slowly */}
        <svg className="minimal-shape shape-circle" viewBox="0 0 100 100" style={{ left: '8%', top: '15%', animationDelay: '0s', animationDuration: '48s' }}>
          <circle cx="50" cy="50" r="38" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
        <svg className="minimal-shape shape-square" viewBox="0 0 100 100" style={{ left: '85%', top: '18%', animationDelay: '-12s', animationDuration: '52s' }}>
          <rect x="18" y="18" width="64" height="64" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
        <svg className="minimal-shape shape-triangle" viewBox="0 0 100 100" style={{ left: '15%', top: '75%', animationDelay: '-24s', animationDuration: '44s' }}>
          <polygon points="50,18 82,75 18,75" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
        <svg className="minimal-shape shape-cross" viewBox="0 0 100 100" style={{ left: '78%', top: '70%', animationDelay: '-6s', animationDuration: '56s' }}>
          <line x1="25" y1="50" x2="75" y2="50" stroke="currentColor" strokeWidth="1.5" />
          <line x1="50" y1="25" x2="50" y2="75" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
    );
  }

  // MINEMINE sea theme background
  return (
    <div 
      className="minemine-bg-container" 
      style={{ '--day-night-delay': randomDelayRef.current } as React.CSSProperties}
      aria-hidden="true"
    >
      {/* 5-Layer Sky Day/Night transition */}
      <div className="sea-sky-container">
        <div className="sky-night"></div>
        <div className="sky-dawn"></div>
        <div className="sky-morning"></div>
        <div className="sky-day"></div>
        <div className="sky-evening"></div>
      </div>

      {/* Stars (twinkle at night) */}
      <div className="stars-layer">
        <div className="star star-1" style={{ top: '8%', left: '12%' }}></div>
        <div className="star star-2" style={{ top: '14%', left: '42%' }}></div>
        <div className="star star-3" style={{ top: '6%', left: '72%' }}></div>
        <div className="star star-4" style={{ top: '22%', left: '28%' }}></div>
        <div className="star star-5" style={{ top: '18%', left: '82%' }}></div>
        <div className="star star-6" style={{ top: '28%', left: '58%' }}></div>
        <div className="star star-7" style={{ top: '10%', left: '90%' }}></div>
        <div className="star star-8" style={{ top: '26%', left: '8%' }}></div>
      </div>

      {/* Sun (Daytime) */}
      <svg className="celestial-body sun-svg" viewBox="0 0 100 100">
        <defs>
          <radialGradient id="sun-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="30%" stopColor="#FFD166" />
            <stop offset="100%" stopColor="rgba(255, 209, 102, 0)" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#sun-glow)" />
      </svg>

      {/* Moon with Halo (Nighttime) */}
      <svg className="celestial-body moon-svg" viewBox="0 0 100 100">
        <defs>
          <radialGradient id="moon-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255, 255, 255, 0.4)" />
            <stop offset="60%" stopColor="rgba(255, 255, 255, 0.08)" />
            <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
          </radialGradient>
        </defs>
        {/* Soft glowing halo */}
        <circle cx="50" cy="50" r="45" fill="url(#moon-halo)" />
        {/* Crescent Moon */}
        <path d="M52,28 C64.15,28 74,37.85 74,50 C74,62.15 64.15,72 52,72 C45.7,72 40.2,69.25 36.25,64.9 C44.9,64.9 52,57.8 52,50 C52,42.2 44.9,35.1 36.25,35.1 C40.2,30.75 45.7,28 52,28 Z" fill="#eaeaea" />
      </svg>

      {/* Flapping Gulls */}
      <div className="gull-container gull-1">
        <svg className="gull" viewBox="0 0 100 50">
          <path className="gull-wings" d="M10,25 Q30,10 50,25 Q70,10 90,25 Q70,20 50,25 Q30,20 10,25 Z" fill="currentColor" />
        </svg>
      </div>
      <div className="gull-container gull-2">
        <svg className="gull" viewBox="0 0 100 50">
          <path className="gull-wings" d="M10,25 Q30,10 50,25 Q70,10 90,25 Q70,20 50,25 Q30,20 10,25 Z" fill="currentColor" />
        </svg>
      </div>

      {/* Sailing Ship */}
      <div className="sailing-ship">
        <svg viewBox="0 0 120 80" className="ship-svg">
          {/* Hull */}
          <path d="M15,55 L105,55 L95,70 L25,70 Z" fill="#3a2f28" />
          {/* Mast & Sails */}
          <line x1="60" y1="15" x2="60" y2="55" stroke="#ffffff" strokeWidth="3.5" />
          <path d="M60,15 Q88,28 60,45 Z" fill="#ffffff" />
          <path d="M60,20 Q36,30 60,45 Z" fill="#e0e0e0" />
          {/* Flag */}
          <path d="M60,15 L74,19 L60,23 Z" fill="#FFD166" />
        </svg>
      </div>

      {/* Waves back & middle */}
      <div className="wave wave-back"></div>
      <div className="wave wave-middle"></div>

      {/* Island silhouette (sandwiched in front of middle waves) */}
      <div className="island-silhouette">
        <svg viewBox="0 0 200 120" className="island-svg">
          {/* Palm Trunk 1 */}
          <path d="M50,95 Q42,70 28,65 Q42,67 52,95 Z" fill="#051524" />
          {/* Palm Leaves 1 */}
          <path d="M28,65 C18,61 2,69 0,75 C8,67 22,64 28,65 Z" fill="#051524" />
          <path d="M28,65 C22,53 32,43 38,39 C32,47 30,57 28,65 Z" fill="#051524" />
          <path d="M28,65 C38,59 52,65 58,71 C46,66 36,65 28,65 Z" fill="#051524" />
          
          {/* Lighthouse Base */}
          <rect x="145" y="55" width="20" height="35" fill="#051524" />
          {/* Gallery / Balcony */}
          <rect x="141" y="51" width="28" height="4" fill="#051524" />
          {/* Light Room */}
          <rect x="146" y="41" width="18" height="10" fill="#051524" />
          {/* Dome / Roof */}
          <path d="M146,41 Q155,29 164,41 Z" fill="#051524" />
          
          {/* Island Land */}
          <path d="M10,95 C55,75 135,70 190,85 L200,120 L0,120 Z" fill="#051524" />
        </svg>

        {/* Lighthouse rotating beam container */}
        <div className="lighthouse-beam-container">
          <div className="lighthouse-beam"></div>
        </div>
      </div>

      {/* Lighthouse reflection on water */}
      <div className="lighthouse-reflection"></div>

      {/* Front wave */}
      <div className="wave wave-front"></div>
    </div>
  );
}
