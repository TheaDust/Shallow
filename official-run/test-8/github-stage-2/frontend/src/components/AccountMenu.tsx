import { useEffect, useId, useRef, useState } from "react";

import type { Account } from "../api/auth";
import { makeHash } from "../lib/hash-route";
import { Button } from "../ui";

export interface AccountMenuProps {
  account: Account;
}

/**
 * Upper-right account menu: shows the signed-in account, the “Your organizations”
 * entry, and the entries to account settings and sign out.
 */
export function AccountMenu({ account }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={rootRef}>
      <Button
        ref={triggerRef}
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        Account menu
      </Button>
      {open ? (
        <div id={panelId} role="menu" aria-label="Account menu" className="account-menu__panel">
          <p className="account-menu__account">Signed in as {account.username}</p>
          <a className="account-menu__item" href={makeHash("/organizations")} onClick={() => setOpen(false)}>
            Your organizations
          </a>
          <a className="account-menu__item" href={makeHash("/settings")} onClick={() => setOpen(false)}>
            Settings
          </a>
          <a className="account-menu__item" href={makeHash("/signout")} onClick={() => setOpen(false)}>
            Sign out
          </a>
        </div>
      ) : null}
    </div>
  );
}
