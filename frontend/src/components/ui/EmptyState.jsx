import './ui.css';

export function EmptyState({
  icon = '📭',
  title,
  description,
  action,
  className = ''
}) {
  return (
    <div className={`ss-empty-state ${className}`} role="status">
      <div className="ss-empty-state-icon" aria-hidden="true">{icon}</div>
      {title && <h4 className="ss-empty-state-title">{title}</h4>}
      {description && <p style={{ margin: '4px 0 16px 0', fontSize: '0.9rem' }}>{description}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}

export default EmptyState;
