import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useSession, type SessionUser } from "../lib/session";
import { OrganizationLink } from "../features/organizations/OrganizationLink";
import { SignOutDialog } from "./SignOutDialog";

export interface AccountMenuProps {
  user: SessionUser;
}

/**
 * The upper-right account control (REQ-1/REQ-1-2): a button named
 * "Account menu" that shows the signed-in account, links to the
 * "Your organizations" page, lists the user's organizations, and offers the
 * single "Sign out" entry.
 */
export function AccountMenu({ user }: AccountMenuProps) {
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-menu-entry]") ?? []);
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    const next = current === -1
      ? (event.key === "ArrowDown" ? 0 : items.length - 1)
      : (current + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="account-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        className="account-menu__trigger"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-menu__avatar" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>
        <span className="account-menu__username">{user.username}</span>
      </button>
      {open ? (
        <div className="account-menu__panel" role="menu" aria-label="Account menu">
          <a
            data-menu-entry
            href="#/organizations"
            onClick={() => setOpen(false)}
          >
            Your organizations
          </a>
          {user.organizations.length > 0 ? (
            <ul className="account-menu__organizations">
              {user.organizations.map((organization) => (
                <li key={organization.name}>
                  <OrganizationLink organization={organization} className="account-menu__organization" />
                </li>
              ))}
            </ul>
          ) : null}
          <a
            data-menu-entry
            href="#/settings"
            onClick={() => setOpen(false)}
          >
            Settings
          </a>
          <a
            data-menu-entry
            className="account-menu__signout"
            href="#/sign-out"
            onClick={(event) => {
              event.preventDefault();
              setOpen(false);
              setConfirming(true);
            }}
          >
            Sign out
          </a>
        </div>
      ) : null}
      <SignOutDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => {
          setConfirming(false);
          void signOut();
        }}
      />
    </div>
  );
}
