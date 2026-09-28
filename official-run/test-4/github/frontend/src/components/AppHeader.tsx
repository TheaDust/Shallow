import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { AccountMenu, SignOutDialog } from "./AccountMenu";
import { GlobalSearch } from "./GlobalSearch";
import { useSession } from "../session";

/**
 * Shared page chrome: brand link, the upper-right account menu (or a Sign in
 * link for anonymous visitors), and the sign-out confirmation dialog. The
 * page content is wrapped so it becomes inert while the dialog is open.
 */
export function AppHeader({ children }: { children: ReactNode }) {
  const { status, account } = useSession();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    if (signOutOpen) {
      page.setAttribute("inert", "");
    } else {
      page.removeAttribute("inert");
    }
  }, [signOutOpen]);

  return (
    <>
      <div ref={pageRef} className="page">
        <header className="page-header">
          <div className="page-header__left">
            <a className="page-header__brand" href="#/">
              GitHub Collaboration Platform
            </a>
            <GlobalSearch />
          </div>
          {status === "authenticated" && account ? (
            <AccountMenu account={account} onSignOutRequest={() => setSignOutOpen(true)} />
          ) : (
            <a href="#/signin">Sign in</a>
          )}
        </header>
        {children}
      </div>
      {signOutOpen && (
        <SignOutDialog
          onClose={() => {
            setSignOutOpen(false);
          }}
        />
      )}
    </>
  );
}
