import { useCallback, useEffect, useState } from "react";

import { ErrorNote, LoadingNote } from "../components/ViewState";
import { ApiError } from "../lib/api";
import { fetchSessions, revokeSession, type AccountSession } from "../lib/auth-api";
import { formatRelativeTime } from "../lib/format";
import { Button } from "../ui/Button";

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Unable to load this view";
}

/**
 * Security page (REQ-1-4) listing the active browser sessions of the signed-in
 * account. Only non-secret metadata is rendered: a device label, last-active
 * information and the revoke control for sessions other than this browser.
 */
export function SessionsPage() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError(null);
    fetchSessions().then(
      (data) => {
        if (!active) return;
        setSessions(data);
        setStatus("ready");
      },
      (reason: unknown) => {
        if (!active) return;
        setError(errorMessage(reason));
        setStatus("error");
      },
    );
    return () => {
      active = false;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const handleRevoke = async (id: string) => {
    if (revoking) return;
    setRevoking(id);
    setActionError(null);
    setStatusMessage(null);
    try {
      setSessions(await revokeSession(id));
      setStatusMessage("Session revoked");
    } catch (reason: unknown) {
      setActionError(errorMessage(reason));
    }
    setRevoking(null);
  };

  return (
    <main className="page">
      <section className="page__body settings">
        <h1 className="settings__title">Active sessions</h1>
        {statusMessage ? (
          <p className="auth__status" role="status">
            {statusMessage}
          </p>
        ) : null}
        {actionError ? (
          <p className="auth__error" role="alert">
            {actionError}
          </p>
        ) : null}
        {status === "loading" ? <LoadingNote label="Loading sessions…" /> : null}
        {status === "error" && error ? (
          <ErrorNote error={{ message: error, status: 0 }} onRetry={reload} />
        ) : null}
        {status === "ready" ? (
          <table className="sessions__table">
            <caption className="sessions__caption">
              Active sessions for your account.
            </caption>
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">Last active</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="sessions__row">
                  <td className="sessions__device">{session.deviceLabel}</td>
                  <td className="sessions__last-active">
                    Last active {formatRelativeTime(session.lastActiveAt)}
                  </td>
                  <td className="sessions__action">
                    {session.current ? (
                      <span className="sessions__current">Current session</span>
                    ) : (
                      <Button
                        variant="secondary"
                        disabled={revoking === session.id}
                        onClick={() => handleRevoke(session.id)}
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
