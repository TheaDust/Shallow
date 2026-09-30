import { useEffect, useId, useRef, useState } from "react";

import type { AccountSummary } from "../lib/accounts-api";
import { Button, Dialog } from "../ui";

export interface AccountMenuProps {
  account: AccountSummary;
  onSignOut(): void;
}

/**
 * Upper-right control showing the signed-in account. The username is a link
 * that opens the menu, next to the account-menu button; the popup holds the
 * visible entries of the session: the organization list of the account, Settings
 * and the single Sign out link that opens the confirmation dialog.
 */
export function AccountMenu({ account, onSignOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    itemRefs.current[0]?.focus();
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const focusItem = (index: number) => {
    const items = itemRefs.current.filter((node): node is HTMLAnchorElement => Boolean(node));
    if (!items.length) return;
    items[(index + items.length) % items.length].focus();
  };

  const closeMenu = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const toggleMenu = () => setOpen((value) => !value);

  return (
    <div className="ui-menu account-menu" ref={rootRef}>
      {/* The username is the visible account entry of the control; it opens the
          same menu as the icon button next to it. */}
      <a
        className="account-menu__username"
        href="#/settings"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.preventDefault();
          toggleMenu();
        }}
      >
        {account.username}
      </a>
      <Button
        ref={triggerRef}
        variant="secondary"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggleMenu}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (open) focusItem(event.key === "ArrowDown" ? 1 : -1);
            else setOpen(true);
          }
        }}
      >
        <span aria-hidden="true" className="account-menu__avatar">
          {account.username.slice(0, 1).toUpperCase()}
        </span>
      </Button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account menu"
          className="ui-menu__content"
          onKeyDown={(event) => {
            const current = itemRefs.current.findIndex((node) => node === document.activeElement);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              focusItem(current + (event.key === "ArrowDown" ? 1 : -1));
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              focusItem(event.key === "Home" ? 0 : -1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeMenu();
            }
          }}
        >
          <a
            ref={(node) => {
              itemRefs.current[0] = node;
            }}
            className="ui-menu__item"
            href="#/organizations"
            onClick={() => setOpen(false)}
          >
            Your organizations
          </a>
          <a
            ref={(node) => {
              itemRefs.current[1] = node;
            }}
            className="ui-menu__item"
            href="#/settings"
            onClick={() => setOpen(false)}
          >
            Settings
          </a>
          <a
            ref={(node) => {
              itemRefs.current[2] = node;
            }}
            className="ui-menu__item"
            href="#/signout"
            onClick={(event) => {
              // Sign-out is confirmed in a dialog, so the entry never navigates.
              event.preventDefault();
              setOpen(false);
              setConfirming(true);
            }}
          >
            Sign out
          </a>
        </div>
      ) : null}
      {confirming ? (
        <Dialog
          open
          title="Sign out"
          description="Signing out ends only the current browser session."
          closeLabel="Close"
          onOpenChange={setConfirming}
          actions={
            <>
              <Button
                variant="primary"
                onClick={() => {
                  setConfirming(false);
                  onSignOut();
                }}
              >
                Confirm sign out
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          }
        >
          <p>Other browsers and devices stay signed in.</p>
        </Dialog>
      ) : null}
    </div>
  );
}
