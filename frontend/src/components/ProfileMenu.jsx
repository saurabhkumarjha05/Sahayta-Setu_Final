import { useEffect, useRef, useState } from "react";

// The avatar + name block in each dashboard header, with a dropdown to log out.
// className / avatarClassName keep each dashboard's own styling.
function ProfileMenu({ className, avatarClassName, initials, name, subtitle, phone, onLogout }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  // Close the dropdown when clicking anywhere else
  useEffect(() => {
    if (!open) return;
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className={`${className} profile-menu`} ref={menuRef}>
      <button
        type="button"
        className="profile-menu-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <div className={avatarClassName}>{initials}</div>

        <div>
          <strong>{name}</strong>
          <small>{subtitle}</small>
        </div>

        <span>{open ? "⌃" : "⌄"}</span>
      </button>

      {open && (
        <div className="profile-dropdown">
          <div className="profile-dropdown-info">
            <strong>{name}</strong>
            {phone && <small>{phone}</small>}
          </div>

          <button type="button" className="profile-logout" onClick={onLogout}>
            ⎋ Log out
          </button>
        </div>
      )}
    </div>
  );
}

export default ProfileMenu;
