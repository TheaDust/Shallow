import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { useHashLocation } from "../../lib/hash-route";
import { getRepositoryContents, type RepoRole, type RepositoryContents } from "./api";
import { AccessDenied } from "./AccessDenied";
import { BranchSelector } from "./BranchSelector";
import { RepoPageHeader } from "./RepoPageHeader";

const WRITABLE_ROLES: RepoRole[] = ["write", "maintain", "admin"];

function Breadcrumbs({
  owner,
  name,
  branch,
  path,
  leaf,
}: {
  owner: string;
  name: string;
  branch: string;
  path: string;
  leaf: string;
}) {
  const segments = path.split("/").filter(Boolean);
  return (
    <nav className="code-breadcrumbs" aria-label="Breadcrumb">
      <a href={`#/repos/${owner}/${name}/tree?branch=${encodeURIComponent(branch)}`}>root</a>
      {segments.map((segment, index) => {
        const current = segments.slice(0, index + 1).join("/");
        const isLeaf = index === segments.length - 1;
        return (
          <span key={current} className="code-breadcrumbs__item">
            <span aria-hidden="true">/</span>
            {isLeaf ? (
              <a
                href={`#/repos/${owner}/${name}/blob?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(current)}`}
                aria-current="location"
              >
                {segment}
              </a>
            ) : (
              <a href={`#/repos/${owner}/${name}/tree?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(current)}`}>
                {segment}
              </a>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function BlobPage({ owner, name }: { owner: string; name: string }) {
  const location = useHashLocation();
  const branch = location.search.get("branch") ?? undefined;
  const path = location.search.get("path") ?? "";
  const [contents, setContents] = useState<RepositoryContents | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    getRepositoryContents(owner, name, { branch, path })
      .then((result) => {
        if (cancelled) return;
        setContents(result);
        setState("ok");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setState("denied");
        else setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, branch, path]);

  if (state === "denied") return <AccessDenied />;
  if (state === "missing") {
    return (
      <section className="blob-page">
        <RepoPageHeader owner={owner} name={name} branch={branch} />
        <p className="blob-page__missing">File not found</p>
      </section>
    );
  }
  if (state === "loading" || !contents) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  if (contents.type === "dir") {
    return (
      <section className="blob-page">
        <RepoPageHeader owner={owner} name={name} branch={contents.branch} />
        <p className="blob-page__missing">This is a directory.</p>
      </section>
    );
  }

  const writable = contents.myRole !== null && WRITABLE_ROLES.includes(contents.myRole);

  return (
    <section className="blob-page">
      <RepoPageHeader owner={owner} name={name} branch={contents.branch} />
      <BranchSelector owner={owner} name={name} currentBranch={contents.branch} canCreate={writable} />
      <Breadcrumbs owner={owner} name={name} branch={contents.branch} path={contents.path} leaf={contents.name} />
      {contents.commit ? (
        <p className="blob-page__commit">
          {contents.commit.message} by {contents.commit.author}
        </p>
      ) : null}
      <div className="code-toolbar">
        <a
          className="code-toolbar__commits"
          href={`#/repos/${owner}/${name}/commits?branch=${encodeURIComponent(contents.branch)}&path=${encodeURIComponent(contents.path)}`}
        >
          Commits
        </a>
        {writable ? (
          <a
            className="ui-button ui-button--secondary code-toolbar__edit"
            href={`#/repos/${owner}/${name}/edit?branch=${encodeURIComponent(contents.branch)}&path=${encodeURIComponent(contents.path)}`}
          >
            Edit
          </a>
        ) : null}
      </div>
      <pre className="blob-page__content">{contents.content}</pre>
    </section>
  );
}
