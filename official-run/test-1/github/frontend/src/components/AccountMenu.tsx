import { useEffect, useRef, useState } from 'react';
import type { User } from '../api';
import SignOutDialog from './SignOutDialog';

export default function AccountMenu({
  user,
  onSignedOut,
}: {
  user: User;
  onSignedOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={rootRef}>
      <span className="account-menu-user">{user.username}</span>
      <button
        className="account-menu-button"
        aria-label="Account menu"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden="true">
          {user.username.slice(0, 1).toUpperCase()}
        </span>
      </button>
      {open && (
        <div className="account-menu-panel">
          <p className="menu-user">
            Signed in as <strong>{user.username}</strong>
          </p>
          <h3>Organizations</h3>
          <ul className="menu-orgs">{/* Organization list populated by later modules. */}</ul>
          <a
            href="#/settings"
            className="menu-settings"
            onClick={() => setOpen(false)}
          >
            Settings
          </a>
          <a
            href="#/"
            className="menu-signout"
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
              setDialogOpen(true);
            }}
          >
            Sign out
          </a>
        </div>
      )}
      {dialogOpen && (
        <SignOutDialog
          onConfirm={() => {
            setDialogOpen(false);
            onSignedOut();
          }}
          onCancel={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
