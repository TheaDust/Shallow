import { useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { ErrorNote, LoadingNote } from "../components/ViewState";
import { fetchAccountSessions, revokeAccountSession, type AccountSession } from "../lib/auth-api";
import { formatRelativeTime } from "../lib/format";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";

/**
 * Security page listing every active browser session of the signed-in account.
 * Each row names the device and when it was last active; only sessions other
 * than the current one can be revoked, and the current session is marked as
 * such. Session secrets never reach the page — the listed handle is a separate
 * public identifier used by "Revoke session".
 */
export function ActiveSessionsPage() {
  const sessions = useAsyncData(() => fetchAccountSessions(), []);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const revoke = async (session: AccountSession) => {
    if (busyId) return;
    setBusyId(session.id);
    setMessage(null);
    setError(null);
    try {
      const result = await revokeAccountSession(session.id);
      if (result.ok) {
        setMessage(result.message);
        sessions.reload();
      } else {
        setError(result.message);
      }
    } catch {
      setError("Unable to revoke the session. Please try again.");
    }
    setBusyId(null);
  };

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body settings">
        <h1 className="settings__title">Active sessions</h1>
        {message ? (
          <p className="auth__status" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="auth__error" role="alert">
            {error}
          </p>
        ) : null}
        {sessions.status === "loading" ? <LoadingNote label="Loading sessions…" /> : null}
        {sessions.status === "error" && sessions.error ? (
          <ErrorNote error={sessions.error} onRetry={sessions.reload} />
        ) : null}
        {sessions.status === "ready" && sessions.data ? (
          <table className="sessions-table">
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">Last active</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.map((session) => (
                <tr
                  key={session.id}
                  className="sessions-table__row"
                  aria-label={`${session.device} session`}
                >
                  <td className="sessions-table__device">
                    <span className="sessions-table__device-name">{session.device}</span>
                    {session.current ? (
                      <span className="sessions-table__current">Current session</span>
                    ) : null}
                  </td>
                  <td className="sessions-table__last-active">
                    <span className="sessions-table__label">Last active</span>{" "}
                    <span className="sessions-table__value">
                      {formatRelativeTime(session.lastActive)}
                    </span>
                  </td>
                  <td className="sessions-table__controls">
                    {session.active ? (
                      session.current ? null : (
                        <Button
                          variant="secondary"
                          disabled={busyId === session.id}
                          onClick={() => void revoke(session)}
                        >
                          Revoke session
                        </Button>
                      )
                    ) : (
                      <span className="sessions-table__state">Inactive</span>
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
