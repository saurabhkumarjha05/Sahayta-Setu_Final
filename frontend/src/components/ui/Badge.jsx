import './ui.css';

const DEFAULT_ICONS = {
  emergency: '🚨',
  safe: '✓',
  warning: '⚠️',
  info: 'ℹ️',
  neutral: '●'
};

export function Badge({
  variant = 'neutral', // emergency | safe | warning | info | neutral
  icon,
  text,
  children,
  className = '',
  ...props
}) {
  const displayIcon = icon || DEFAULT_ICONS[variant] || '●';
  const label = text || children;

  return (
    <span
      className={`ss-badge ss-badge--${variant} ${className}`}
      role="status"
      {...props}
    >
      <span aria-hidden="true">{displayIcon}</span>
      <span>{label}</span>
    </span>
  );
}

export default Badge;
