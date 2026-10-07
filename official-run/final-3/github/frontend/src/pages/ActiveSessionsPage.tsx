import { useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { ErrorNote, LoadingNote } from "../components/ViewState";
import { fetchActiveSessions, revokeSession, type ActiveSession } from "../lib/auth-api";
import { formatRelativeTime } from "../lib/format";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";

const EMPTY: ActiveSession[] = [];

/**
 * Security page listing the browser sessions of the signed-in account. Every
 * row shows a device label and its last activity; only sessions other than the
 * current one can be revoked, and a revoked row stays visible as inactive. The
 * list never renders a session secret or token.
 */
export function ActiveSessionsPage() {
  const sessions = useAsyncData(() => fetchActiveSessions(), []);
  const [updated, setUpdated] = useState<ActiveSession[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const rows = updated ?? sessions.data ?? EMPTY;

  const revoke = async (key: string) => {
    if (pendingKey) return;
    setPendingKey(key);
    setActionError(null);
    try {
      setUpdated(await revokeSession(key));
    } catch {
      setActionError("Unable to revoke this session. Please try again.");
    }
    setPendingKey(null);
  };

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body settings">
        <h1 className="settings__title">Active sessions</h1>
        {sessions.status === "loading" ? <LoadingNote label="Loading sessions…" /> : null}
        {sessions.status === "error" && sessions.error ? (
          <ErrorNote error={sessions.error} onRetry={sessions.reload} />
        ) : null}
        {actionError ? (
          <p className="auth__error" role="alert">
            {actionError}
          </p>
        ) : null}
        {sessions.status !== "loading" ? (
          <table className="session-table">
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">Activity</th>
                <th scope="col">Session</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((session) => (
                <tr
                  key={session.key}
                  className={session.revoked ? "session-table__row session-table__row--revoked" : "session-table__row"}
                  aria-current={session.current ? "true" : undefined}
                >
                  <td className="session-table__device">{session.device}</td>
                  <td className="session-table__activity">
                    Last active {formatRelativeTime(session.lastActiveAt)}
                  </td>
                  <td className="session-table__action">
                    {session.current ? (
                      <span className="session-table__current">Current session</span>
                    ) : session.revoked ? (
                      <span className="session-table__revoked">Session revoked</span>
                    ) : (
                      <Button
                        variant="secondary"
                        disabled={pendingKey === session.key}
                        onClick={() => void revoke(session.key)}
                      >
                        Revoke session
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </main>
  );
}
