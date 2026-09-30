import { useCallback, useEffect, useState } from "react";

import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { fetchRepositoryAccess, type RepositoryAccessPayload } from "../lib/repository-access-api";
import { repositoryTitle } from "../lib/repositories-api";
import { RepositoryAccessPanel } from "../repository/RepositoryAccessPanel";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { RepositorySettingsNav } from "../repository/RepositorySettingsNav";

export interface RepositoryAccessPageProps {
  owner: string;
  name: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; access: RepositoryAccessPayload }
  | { status: "denied" }
  | { status: "forbidden"; message: string }
  | { status: "missing" }
  | { status: "error" };

/**
 * Repository Settings → Manage access (REQ-2-3). An organization Owner or a
 * repository Admin grants roles to the current organization members and teams;
 * the server refuses the page for anybody else, so a direct link never exposes
 * the grants.
 */
export function RepositoryAccessPage({ owner, name }: RepositoryAccessPageProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    fetchRepositoryAccess(owner, name).then(
      (access) => {
        if (active) setState({ status: "ready", access });
      },
      (failure: unknown) => {
        if (!active) return;
        const error = failure as { status?: number; message?: string };
        if (error.status === 403 && error.message === "Access denied") {
          setState({ status: "denied" });
          return;
        }
        if (error.status === 403) {
          setState({ status: "forbidden", message: error.message ?? "" });
          return;
        }
        if (error.status === 404) {
          setState({ status: "missing" });
          return;
        }
        setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [owner, name, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading access…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "missing") return <NotFoundPage hint={repositoryAccessHint()} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Access unavailable</h1>
        <p role="alert">The access list could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  const repository = state.status === "ready" ? state.access.repository : null;

  return (
    <main>
      <RepositoryChrome
        owner={owner}
        name={name}
        title={repository ? repositoryTitle(repository) : `${owner}/${name}`}
        visibility={repository ? repository.visibility : "private"}
        description={repository?.description}
        activeEntry="Settings"
      />
      <RepositorySettingsNav owner={owner} name={name} current="access" />
      {state.status === "forbidden" ? (
        <p role="alert">{state.message || "You must be a repository administrator to manage access."}</p>
      ) : (
        <RepositoryAccessPanel
          owner={owner}
          name={name}
          access={state.access}
          onChanged={reload}
        />
      )}
    </main>
  );
}
