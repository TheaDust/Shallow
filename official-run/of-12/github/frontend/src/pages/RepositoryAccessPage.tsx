import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { useSession } from "../lib/session";
import { fetchRepositoryAccess, type RepositoryAccessDetail } from "../features/repository-access/access-api";
import { ManageAccessPanel } from "../features/repository-access/ManageAccessPanel";

export interface RepositoryAccessPageProps {
  owner: string;
  name: string;
}

type LoadState = "loading" | "ready" | "denied" | "missing" | "failed";

/**
 * Repository Manage-access page reached through the repository "Settings"
 * link (REQ-2-3). Only an organization Owner or repository Admin is served the
 * page; anyone else is refused, and the server refuses the same write even if
 * the page were reachable.
 */
export function RepositoryAccessPage({ owner, name }: RepositoryAccessPageProps) {
  const { user } = useSession();
  const [detail, setDetail] = useState<RepositoryAccessDetail | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let active = true;
    setState("loading");
    setDetail(null);
    fetchRepositoryAccess(owner, name)
      .then((result) => {
        if (!active) return;
        setDetail(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setState("denied");
        else if (error instanceof ApiError && error.status === 404) setState("missing");
        else setState("failed");
      });
    return () => {
      active = false;
    };
  }, [owner, name]);

  if (state === "denied") {
    return (
      <main className="repository-access-page">
        <h1>Access denied</h1>
        <p>Only an organization Owner or repository Admin can manage the access of this repository.</p>
        <p>
          <a href="#/sign-in">{user ? "Switch account" : "Sign in"}</a>
        </p>
      </main>
    );
  }

  if (state === "missing") {
    return (
      <main className="repository-access-page">
        <h1>Repository not found</h1>
        <p>
          <a href="#/">Back to home</a>
        </p>
      </main>
    );
  }

  if (state === "failed" || !detail) {
    return (
      <main className="repository-access-page">
        {state === "failed" ? (
          <p role="alert">The repository access list could not be loaded. Please try again.</p>
        ) : (
          <p role="status">Loading repository access…</p>
        )}
      </main>
    );
  }

  return (
    <main className="repository-access-page">
      <h1>Manage access</h1>
      <p className="repository-access-page__repository">{detail.repository.fullName}</p>
      <ManageAccessPanel owner={owner} name={name} detail={detail} onDetailChange={setDetail} />
    </main>
  );
}
