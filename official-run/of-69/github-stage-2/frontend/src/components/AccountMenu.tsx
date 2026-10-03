import { useEffect, useRef, useState } from "react";

import { navigate } from "../lib/hash-route";
import { Button } from "../ui";
import { SignOutDialog } from "./SignOutDialog";

export interface AccountMenuProps {
  username: string;
  onSignOut(): Promise<void> | void;
}

/**
 * Upper-right account control. Its popup shows the signed-in account and the
 * entries that lead to account Settings or, through the confirmation dialog,
 * out of the current browser session.
 */
export function AccountMenu({ username, onSignOut }: AccountMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [menuOpen]);

  const toggleMenu = () => setMenuOpen((value) => !value);

  return (
    <div className="account-menu" ref={rootRef}>
      {/* The signed-in handle is itself a trigger of the same popup, so the
          header always names the account the session belongs to. */}
      <Button
        variant="secondary"
        className="account-menu__identity"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={toggleMenu}
      >
        <span className="account-menu__avatar" aria-hidden="true">
          {username.slice(0, 1).toUpperCase()}
        </span>
        {username}
      </Button>
      <Button
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={toggleMenu}
      >
        Account menu
      </Button>
      {menuOpen ? (
        <div className="account-menu__popup">
          <p className="account-menu__user">{username}</p>
          <a
            href="#/organizations"
            onClick={(event) => {
              event.preventDefault();
              // Route first, then unmount the popup, so navigation never depends
              // on a link that is already gone.
              navigate("/organizations");
              setMenuOpen(false);
            }}
          >
            Your organizations
          </a>
          <a
            href="#/settings"
            onClick={(event) => {
              event.preventDefault();
              // Route first, then unmount the popup, so navigation never depends
              // on a link that is already gone.
              navigate("/settings");
              setMenuOpen(false);
            }}
          >
            Settings
          </a>
          <a
            href="#/"
            onClick={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              setConfirmOpen(true);
            }}
          >
            Sign out
          </a>
        </div>
      ) : null}
      <SignOutDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={async () => {
          setConfirmOpen(false);
          await onSignOut();
        }}
      />
    </div>
  );
}
