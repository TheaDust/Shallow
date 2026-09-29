import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { formatUpdatedTime } from "../../lib/format";
import { useSession } from "../auth/session";
import { getRepository, type RepositoryOverview } from "./api";
import { AccessDenied } from "./AccessDenied";
import { ClonePopover } from "./ClonePopover";
import { ForkDialog } from "./ForkDialog";
import { RepoNav } from "../issues/RepoNav";

export function RepositoryPage({ owner, name }: { owner: string; name: string }) {
  const { session } = useSession();
  const [repository, setRepository] = useState<RepositoryOverview | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "denied" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getRepository(owner, name)
      .then((repo) => {
        if (cancelled) return;
        setRepository(repo);
        setStatus("ok");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setStatus("denied");
        else setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  if (status === "denied") return <AccessDenied />;
  if (status === "missing") {
    return (
      <section className="repository">
        <h1>Repository not found</h1>
      </section>
    );
  }
  if (status === "loading" || !repository) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const canManage = repository.myRole === "admin";
  const authenticated = session.status === "authenticated";
  const files = repository.files ?? [];

  return (
    <section className="repository">
      <header className="repository__header">
        <div className="repository__identity">
          <h1>
            {owner}/{name}
          </h1>
          {repository.forkSource ? (
            <p className="repository__forked">
              Forked from{" "}
              <a
                href={`#/repos/${repository.forkSource.owner}/${repository.forkSource.name}`}
              >
                {repository.forkSource.name}
              </a>
            </p>
          ) : null}
          <div className="repository__meta">
            <span className="repository__visibility">
              {repository.visibility === "public" ? "Public" : "Private"}
            </span>
            <span className="repository__branch">Default branch: {repository.defaultBranch}</span>
            <span className="repository__updated">
              Updated {formatUpdatedTime(repository.updatedAt)}
            </span>
          </div>
          {repository.description ? (
            <p className="repository__description">{repository.description}</p>
          ) : null}
        </div>
        <div className="repository__actions">
          <ClonePopover owner={owner} name={name} />
          {authenticated ? <ForkDialog repository={repository} /> : null}
          {canManage ? (
            <a
              className="ui-button ui-button--secondary repository__settings"
              href={`#/repos/${owner}/${name}/settings`}
            >
              Settings
            </a>
          ) : null}
        </div>
      </header>

      <RepoNav owner={owner} name={name} active="code" />

      <div className="repository__files">
        <div className="code-toolbar">
          <a className="code-toolbar__commits" href={`#/repos/${owner}/${name}/commits`}>
            Commits
          </a>
        </div>
        {files.length === 0 ? (
          <p className="repository__files-empty">No files in this repository yet.</p>
        ) : (
          <ul className="repo-files">
            {files.map((file) =>
              file.type === "dir" ? (
                <li key={file.path} className="repo-files__item">
                  <a
                    href={`#/repos/${owner}/${name}/tree?branch=${encodeURIComponent(repository.defaultBranch)}&path=${encodeURIComponent(file.path)}`}
                  >
                    {file.name}
                    <span aria-hidden="true">/</span>
                  </a>
                </li>
              ) : (
                <li key={file.path} className="repo-files__item">
                  <a
                    href={`#/repos/${owner}/${name}/blob?branch=${encodeURIComponent(repository.defaultBranch)}&path=${encodeURIComponent(file.path)}`}
                  >
                    {file.name}
                  </a>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
