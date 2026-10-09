import { useEffect } from 'react';
import './ui.css';
import '../../styles/animations.css';

export function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  className = '',
  role = 'dialog'
}) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="ss-modal-backdrop anim-backdrop-fade"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
      role={role}
      aria-modal="true"
      aria-label={title}
    >
      <div className={`ss-modal-content anim-sheet-slide-up ${className}`}>
        <div className="ss-modal-drag-indicator" aria-hidden="true" />
        {title && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>{title}</h3>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '1.4rem',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  lineHeight: 1
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export default BottomSheet;
