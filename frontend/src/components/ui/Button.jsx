import './ui.css';

export function Button({
  children,
  variant = 'primary', // primary | danger | safe | ghost | outline
  fullWidth = false,
  className = '',
  disabled = false,
  type = 'button',
  onClick,
  ...props
}) {
  return (
    <button
      type={type}
      className={`ss-btn ss-btn--${variant} ${fullWidth ? 'ss-btn--full' : ''} ${className}`}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
}

export default Button;
