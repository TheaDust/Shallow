import { useEffect, useState, type FormEvent } from "react";

import { useHashLocation, navigate } from "../../lib/hash-route";
import { ApiError } from "../../lib/api";
import { Menu } from "../../ui";
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
  leaf: string | null;
}) {
  const segments = path.split("/").filter(Boolean);
  return (
    <nav className="code-breadcrumbs" aria-label="Breadcrumb">
      <a href={`#/repos/${owner}/${name}/tree?branch=${encodeURIComponent(branch)}`}>root</a>
      {segments.map((segment, index) => {
        const current = segments.slice(0, index + 1).join("/");
        const isLeaf = leaf !== null && index === segments.length - 1;
        return (
          <span key={current} className="code-breadcrumbs__item">
            <span aria-hidden="true">/</span>
            {isLeaf ? (
              <span aria-current="location">{segment}</span>
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

export function CodePage({ owner, name }: { owner: string; name: string }) {
  const location = useHashLocation();
  const branch = location.search.get("branch") ?? undefined;
  const path = location.search.get("path") ?? "";
  const [contents, setContents] = useState<RepositoryContents | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied" | "missing">("loading");
  const [query, setQuery] = useState("");

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
      <section className="code-page">
        <RepoPageHeader owner={owner} name={name} branch={branch} />
        <p className="code-page__empty">Not found</p>
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

  const writable = contents.myRole !== null && WRITABLE_ROLES.includes(contents.myRole);
  const branchParam = new URLSearchParams({ branch: contents.branch });

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const q = query.trim();
    if (q) params.set("q", q);
    navigate(`/repos/${owner}/${name}/search`, params);
  };

  if (contents.type === "file") {
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
        <pre className="blob-page__content">{contents.content}</pre>
      </section>
    );
  }

  return (
    <section className="code-page">
      <RepoPageHeader owner={owner} name={name} branch={contents.branch} />
      <BranchSelector owner={owner} name={name} currentBranch={contents.branch} canCreate={writable} />
      <Breadcrumbs owner={owner} name={name} branch={contents.branch} path={contents.path} leaf={null} />
      <div className="code-toolbar">
        <a
          className="code-toolbar__commits"
          href={`#/repos/${owner}/${name}/commits?branch=${encodeURIComponent(contents.branch)}`}
        >
          Commits
        </a>
        <span className="code-toolbar__count">{contents.commitCount} commits</span>
        <form role="search" className="code-toolbar__search" onSubmit={submitSearch}>
          <input
            type="search"
            aria-label="Search"
            placeholder="Search code"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
        {writable ? (
          <Menu
            triggerLabel="Add file"
            menuLabel="Add file"
            items={[
              {
                id: "create-new-file",
                label: "Create new file",
                onSelect: () =>
                  navigate(`/repos/${owner}/${name}/new`, new URLSearchParams({ branch: contents.branch })),
              },
            ]}
          />
        ) : null}
      </div>
      {contents.entries.length === 0 ? (
        <p className="code-page__empty">No files in this directory.</p>
      ) : (
        <ul className="code-files">
          {contents.entries.map((entry) => (
            <li key={entry.path} className="code-files__item">
              {entry.type === "dir" ? (
                <a
                  href={`#/repos/${owner}/${name}/tree?branch=${encodeURIComponent(contents.branch)}&path=${encodeURIComponent(entry.path)}`}
                >
                  {entry.name}
                  <span aria-hidden="true">/</span>
                </a>
              ) : (
                <a
                  href={`#/repos/${owner}/${name}/blob?branch=${encodeURIComponent(contents.branch)}&path=${encodeURIComponent(entry.path)}`}
                >
                  {entry.name}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
