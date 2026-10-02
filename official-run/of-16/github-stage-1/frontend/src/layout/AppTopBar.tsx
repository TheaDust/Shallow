import { useState } from "react";

import { useSession } from "../auth/SessionContext";
import { navigate } from "../lib/hash-route";
import { Button, Dialog, Menu } from "../ui";

/**
 * Top bar of every page. When a session exists the upper-right account menu
 * shows the current signed-in account: the visible text is the username while
 * the accessible name of the control stays the stable "Account menu". The
 * trigger is a link to "Your organizations" that opens the menu in place, so
 * the same control is reachable both as a link and as a menu trigger. The menu
 * holds a Settings entry and the single "Sign out" link; signing out first asks
 * for confirmation and only then ends the current browser session.
 */
export function AppTopBar() {
  const { status, account, signOut } = useSession();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleConfirmSignOut() {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
      setConfirmSignOut(false);
      navigate("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="app-topbar">
        <a className="app-topbar__brand" href="#/">
          ShallowCode
        </a>
        <div className="app-topbar__session">
          {status === "loading" ? (
            <p className="app-topbar__status" role="status">
              Loading session…
            </p>
          ) : null}
          {account ? (
            <Menu
              triggerLabel="Account menu"
              triggerHref="#/organizations"
              triggerContent={<span className="app-topbar__username">{account.username}</span>}
              items={[
                { id: "organizations", label: "Your organizations", href: "#/organizations" },
                { id: "settings", label: "Settings", href: "#/settings" },
                {
                  id: "sign-out",
                  label: "Sign out",
                  href: "#",
                  onSelect: () => setConfirmSignOut(true),
                },
              ]}
            />
          ) : null}
        </div>
      </header>
      <Dialog
        open={confirmSignOut}
        title="Sign out"
        description="Signing out ends the session for this browser only. Other browsers and devices stay signed in."
        showClose={false}
        onOpenChange={(open) => {
          if (!open) setConfirmSignOut(false);
        }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmSignOut(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              aria-busy={busy}
              onClick={() => {
                void handleConfirmSignOut();
              }}
            >
              Confirm sign out
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}
