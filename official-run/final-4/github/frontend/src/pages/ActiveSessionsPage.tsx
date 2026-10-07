import { useEffect, useState } from "react";

import { LoadingNote } from "../components/ViewState";
import { fetchActiveSessions, revokeSession, type SessionSummary } from "../lib/auth-api";
import { formatRelativeTime } from "../lib/format";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";

/** One row of the list: a session, plus the local "just revoked" mark. */
interface SessionRow extends SessionSummary {
  revoked?: boolean;
}

/**
 * REQ-1-4: the security page that lists the current browser session and the
 * other active sessions of the account. A row shows a device label and its
 * last-active time; only another session can be revoked. The page never renders
 * a session secret — the row is addressed by its public identifier.
 */
export function ActiveSessionsPage() {
  const { status, data, error, reload } = useAsyncData(() => fetchActiveSessions(), []);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "ready" && data) {
      setRows(data);
      setActionError(null);
    }
    if (status === "error") setRows([]);
  }, [status, data]);

  const revoke = async (sessionId: string) => {
    if (busyId) return;
    setBusyId(sessionId);
    setActionError(null);
    try {
      await revokeSession(sessionId);
      // The revoked row carries the single visible outcome; a later read of
      // the page lists active sessions only.
      setRows((current) =>
        current.map((row) => (row.id === sessionId ? { ...row, revoked: true } : row)),
      );
    } catch {
      setActionError("Unable to revoke this session. Please try again.");
    }
    setBusyId(null);
  };

  return (
    <main className="page">
      <section className="page__body settings">
        <h1 className="settings__title">Active sessions</h1>
        {actionError ? (
          <p className="auth__error" role="alert">
            {actionError}
          </p>
        ) : null}
        {status === "loading" ? <LoadingNote label="Loading sessions…" /> : null}
        {status === "error" && error ? (
          <div className="view-error">
            <p className="view-error__message" role="alert">
              {error.message}
            </p>
            <Button variant="secondary" onClick={reload}>
              Retry
            </Button>
          </div>
        ) : null}
        {status === "ready" && rows.length === 0 ? (
          <p className="settings__empty">No active sessions for this account.</p>
        ) : null}
        {rows.length > 0 ? (
          <ul className="sessions__list">
            {rows.map((row) => (
              <li key={row.id} className="sessions__row" data-current={row.current || undefined}>
                <p className="sessions__device">{row.device}</p>
                <p className="sessions__activity">
                  <span className="sessions__activity-label">Last active</span>{" "}
                  <time dateTime={row.lastActiveAt}>{formatRelativeTime(row.lastActiveAt)}</time>
                </p>
                {row.current ? (
                  <p className="sessions__current">Current session</p>
                ) : row.revoked ? (
                  <p className="sessions__revoked">Session revoked</p>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={busyId === row.id}
                    onClick={() => revoke(row.id)}
                  >
                    Revoke session
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
