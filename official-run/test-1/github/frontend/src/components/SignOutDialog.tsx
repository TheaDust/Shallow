import { useEffect, useRef } from 'react';

export default function SignOutDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Sign out"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="dialog">
        <h2>Sign out</h2>
        <p>Signing out affects only the current browser session.</p>
        <div className="dialog-actions">
          <button type="button" className="primary-button" ref={confirmRef} onClick={onConfirm}>
            Confirm sign out
          </button>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
