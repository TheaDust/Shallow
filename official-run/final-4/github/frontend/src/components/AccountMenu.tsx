import { useEffect, useRef, useState } from "react";

import { signOut } from "../lib/auth-api";
import { navigate } from "../lib/hash-route";
import { useSession } from "../lib/session";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

/**
 * Upper-right account control. The trigger is the single button named
 * "Account menu"; its menu holds the settings entry and the "Sign out" link.
 * Sign-out is confirmed in a dialog and only then invalidates the browser
 * session, so cancelling or closing the dialog keeps the current page.
 */
export function AccountMenu() {
  const { setUser } = useSession();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const confirmSignOut = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signOut();
      setUser(null);
      setConfirming(false);
      navigate("/");
    } catch {
      setError("Unable to sign out. Please try again.");
    }
    setBusy(false);
  };

  return (
    <div className="account-menu" ref={rootRef}>
      <Button
        ref={triggerRef}
        variant="ghost"
        className="account-menu__trigger"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="account-menu__avatar" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
            <path
              fill="currentColor"
              d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1c-2.7 0-5 1.5-5 3.2V14h10v-1.8C13 10.5 10.7 9 8 9Z"
            />
          </svg>
        </span>
      </Button>

      {open ? (
        <div
          className="account-menu__content"
          role="menu"
          aria-label="Account menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
        >
          <a
            className="account-menu__item"
            href="#/settings"
            onClick={(event) => {
              event.preventDefault();
              navigate("/settings");
              setOpen(false);
            }}
          >
            Settings
          </a>
          <a
            className="account-menu__item"
            href="#/settings/organizations"
            onClick={(event) => {
              event.preventDefault();
              navigate("/settings/organizations");
              setOpen(false);
            }}
          >
            Your organizations
          </a>
          <a
            className="account-menu__item"
            href="#/sign-out"
            onClick={(event) => {
              event.preventDefault();
              setOpen(false);
              setError(null);
              setConfirming(true);
            }}
          >
            Sign out
          </a>
        </div>
      ) : null}

      <Dialog
        open={confirming}
        title="Sign out"
        description="Signing out ends only the current browser session. Other browser sessions stay signed in."
        onOpenChange={(next) => {
          if (!next) {
            setConfirming(false);
            setError(null);
          }
        }}
        actions={
          <>
            <Button variant="primary" disabled={busy} onClick={confirmSignOut}>
              Confirm sign out
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </>
        }
      >
        {error ? (
          <p className="account-menu__error" role="alert">
            {error}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
