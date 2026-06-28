import React from 'react';

const COLORS = [
  { name: 'Yellow', code: '#fef08a' },
  { name: 'Pink', code: '#fbcfe8' },
  { name: 'Green', code: '#bbf7d0' },
  { name: 'Blue', code: '#bfdbfe' }
];

export function StickyNote({
  id,
  x,
  y,
  text,
  color,
  ocrStatus,
  onMove,
  onTextChange,
  onColorChange,
  onDelete
}) {
  
  // 드래그 앤 드롭 핸들러
  const handleMouseDown = (e) => {
    // 텍스트 영역이나 버튼, 색상 선택 요소를 클릭한 경우 드래그하지 않음
    if (
      e.target.tagName === 'TEXTAREA' || 
      e.target.tagName === 'BUTTON' || 
      e.target.classList.contains('color-dot')
    ) {
      return;
    }
    
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = x;
    const initialY = y;

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      // 화면 밖으로 너무 벗어나지 않도록 좌표 조절
      const newX = Math.max(0, initialX + deltaX);
      const newY = Math.max(0, initialY + deltaY);
      
      onMove(id, newX, newY);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      className="sticky-note"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        backgroundColor: color,
        transform: 'translate(0, 0)' // 드래그 렌더링 성능 최적화
      }}
      onMouseDown={handleMouseDown}
    >
      {/* 포스트잇 헤더 (드래그 핸들러 영역 및 삭제 버튼) */}
      <div className="sticky-header">
        <div className="color-selectors">
          {COLORS.map((c) => (
            <span
              key={c.code}
              className={`color-dot ${color === c.code ? 'active' : ''}`}
              style={{ backgroundColor: c.code }}
              onClick={() => onColorChange(id, c.code)}
              title={c.name}
            />
          ))}
        </div>
        <button className="delete-btn" onClick={() => onDelete(id)} title="Delete Note">
          &times;
        </button>
      </div>

      {/* 텍스트 영역 */}
      <textarea
        className="sticky-textarea"
        value={text}
        onChange={(e) => onTextChange(id, e.target.value)}
        placeholder="Type something..."
        disabled={ocrStatus === 'loading'}
      />

      {/* OCR 변환이 진행 중일 때만 로딩 바 표시 */}
      {ocrStatus === 'loading' && (
        <div className="sticky-footer" style={{ border: 'none', paddingTop: 0 }}>
          <div className="ocr-status loading">
            <span className="spinner"></span>
            <span>Converting...</span>
          </div>
        </div>
      )}
    </div>
  );
}
