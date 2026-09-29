import type { ReactNode } from "react";

export function BusyMain({ label = "Loading…" }: { label?: string }) {
  return (
    <main>
      <p role="status">{label}</p>
    </main>
  );
}

/** Shown on protected pages while the visitor has no session. */
export function AuthenticationRequired() {
  return (
    <main>
      <h1>Sign in to continue</h1>
      <p>This page is only available to signed-in accounts.</p>
      <p>
        <a href="#/login">Sign in</a>
      </p>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>The page you requested does not exist.</p>
    </main>
  );
}

/** Inline message for a tab the current viewer may not read. */
export function PanelMessage({ children }: { children: ReactNode }) {
  return (
    <p className="panel-message" role="status">
      {children}
    </p>
  );
}

/** Shown when a private resource is opened without permission. */
export function AccessDeniedMain({ heading = "Access denied" }: { heading?: string }) {
  return (
    <main>
      <h1>{heading}</h1>
      <p>You do not have permission to view this page.</p>
    </main>
  );
}
