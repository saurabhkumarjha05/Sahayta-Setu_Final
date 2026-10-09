import './ui.css';
import '../../styles/animations.css';

export function Skeleton({
  width = '100%',
  height = '20px',
  borderRadius = 'var(--radius-sm, 8px)',
  className = '',
  style = {}
}) {
  return (
    <div
      className={`ss-skeleton anim-skeleton ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style
      }}
      aria-hidden="true"
    />
  );
}

export default Skeleton;
