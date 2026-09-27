import { useEffect, useRef, useState } from 'react';
import type { SessionUser } from '../types';
import { useSession } from '../App';
import { navigate } from '../router';

function SignOutDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signout-dialog-title"
      >
        <h2 id="signout-dialog-title" className="dialog-title">
          Sign out
        </h2>
        <p className="dialog-body">Signing out affects only the current browser session.</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            Confirm sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AccountMenu({ user }: { user: SessionUser }) {
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    linkRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        linkRef.current?.focus();
      }
    };
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
      setConfirming(false);
      setOpen(false);
      navigate('#/');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-menu">
      <button
        ref={buttonRef}
        type="button"
        className="btn account-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Account menu
      </button>
      {open && (
        <div ref={popupRef} className="menu-popup" role="menu" aria-label="Account menu">
          <p className="menu-account">{user.username}</p>
          <a
            ref={linkRef}
            className="menu-item"
            href="#/settings"
            onClick={() => setOpen(false)}
          >
            Settings
          </a>
          <a
            className="menu-item"
            href="#/signout"
            onClick={(event) => {
              event.preventDefault();
              setOpen(false);
              setConfirming(true);
            }}
          >
            Sign out
          </a>
        </div>
      )}
      {confirming && (
        <SignOutDialog
          onCancel={() => {
            setConfirming(false);
            buttonRef.current?.focus();
          }}
          onConfirm={() => void handleConfirm()}
        />
      )}
    </div>
  );
}
