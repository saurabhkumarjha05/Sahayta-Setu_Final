import './ui.css';

export function Card({
  children,
  interactive = false,
  className = '',
  onClick,
  ...props
}) {
  return (
    <div
      className={`ss-card ${interactive ? 'ss-card--interactive' : ''} ${className}`}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  );
}

export default Card;
