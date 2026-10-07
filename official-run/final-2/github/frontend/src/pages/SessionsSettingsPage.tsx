import { useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { Button } from "../ui/Button";
import { ErrorNote, LoadingNote } from "../components/ViewState";
import { fetchActiveSessions, revokeSession, type ActiveSession } from "../lib/auth-api";
import { formatRelativeTime } from "../lib/format";
import { useAsyncData } from "../lib/use-async";

/**
 * Security area page listing every browser session of the signed-in account.
 * The list, the "current session" marker and the revocable sessions all come
 * from the server, which reads the caller from the session cookie; no session
 * id, token or other secret is rendered here.
 */
export function SessionsSettingsPage() {
  const sessions = useAsyncData(() => fetchActiveSessions(), []);
  const [updated, setUpdated] = useState<ActiveSession[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busyHandle, setBusyHandle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRevoke = async (handle: string) => {
    if (busyHandle) return;
    setBusyHandle(handle);
    setError(null);
    setStatus(null);
    try {
      const result = await revokeSession(handle);
      setUpdated(result.sessions);
      setStatus(result.message);
    } catch {
      setError("Unable to revoke the session. Please try again.");
    }
    setBusyHandle(null);
  };

  const rows = updated ?? sessions.data ?? [];

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body settings">
        <h1 className="settings__title">Active sessions</h1>
        {status ? (
          <p className="auth__status" role="status">
            {status}
          </p>
        ) : null}
        {error ? (
          <p className="auth__error" role="alert">
            {error}
          </p>
        ) : null}
        {sessions.status === "loading" && !updated ? <LoadingNote label="Loading sessions…" /> : null}
        {sessions.status === "error" && sessions.error ? (
          <ErrorNote error={sessions.error} onRetry={sessions.reload} />
        ) : null}
        <ul className="session-list" aria-label="Active sessions">
          {rows.map((session) => (
            <li key={session.handle} className="session-list__item">
              <div className="session-list__details">
                <p className="session-list__device">{session.device}</p>
                <p className="session-list__activity">Last active {formatRelativeTime(session.lastActiveAt)}</p>
                <p className="session-list__marks">
                  {session.current ? (
                    <span className="session-list__current">Current session</span>
                  ) : null}
                  {!session.active ? <span className="session-list__inactive">Inactive</span> : null}
                </p>
              </div>
              {session.current || !session.active ? null : (
                <Button
                  variant="secondary"
                  disabled={busyHandle !== null}
                  onClick={() => handleRevoke(session.handle)}
                >
                  Revoke session
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
