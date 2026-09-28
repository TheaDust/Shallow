import { useEffect, useRef, useState } from "react";

import { AccountMenu, SignOutDialog } from "../components/AccountMenu";
import { GlobalSearch } from "../components/GlobalSearch";
import { Account } from "../lib/account-api";
import { formatUpdateTime } from "../lib/org-api";
import { listAccountRepositories, repoHref, RepoDetail } from "../lib/repo-api";
import { useSession } from "../session";

export function HomePage() {
  const { status, account } = useSession();

  if (status === "loading") {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (status === "authenticated" && account) {
    return <Workspace account={account} />;
  }

  return <Landing />;
}

function WorkspaceRepositories({ repositories }: { repositories: RepoDetail[] | null }) {
  return (
    <section aria-label="Repositories">
      <h2>Repositories</h2>
      {repositories === null ? (
        <p>Loading…</p>
      ) : repositories.length === 0 ? (
        <p>No repositories found.</p>
      ) : (
        <ul className="repo-list">
          {repositories.map((repository) => (
            <li
              key={`${repository.ownerType}:${repository.ownerName}:${repository.name}`}
              className="repo-list__item"
            >
              <a href={repoHref(repository)}>{repository.name}</a>
              {repository.description && (
                <p className="repo-list__description">{repository.description}</p>
              )}
              <p className="repo-list__meta">
                <span className="repo-list__visibility">
                  {repository.visibility === "public" ? "Public" : "Private"}
                </span>
                <span>{formatUpdateTime(repository.updatedAt)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Landing() {
  return (
    <>
      <header className="page-header">
        <div className="page-header__left">
          <a className="page-header__brand" href="#/">
            GitHub Collaboration Platform
          </a>
          <GlobalSearch />
        </div>
      </header>
      <main>
        <h1>GitHub Collaboration Platform</h1>
        <p>Sign in to continue to your workspace.</p>
        <nav className="landing__links" aria-label="Account access">
          <a href="#/signup">Sign up</a>
          <a href="#/signin">Sign in</a>
          <a href="#/recover">Forgot password</a>
        </nav>
      </main>
    </>
  );
}

function Workspace({ account }: { account: Account }) {
  const [signOutOpen, setSignOutOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const [repositories, setRepositories] = useState<RepoDetail[] | null>(null);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    if (signOutOpen) {
      page.setAttribute("inert", "");
    } else {
      page.removeAttribute("inert");
    }
  }, [signOutOpen]);

  useEffect(() => {
    let cancelled = false;
    setRepositories(null);
    listAccountRepositories(account.username)
      .then((result) => {
        if (!cancelled) setRepositories(result);
      })
      .catch(() => {
        if (!cancelled) setRepositories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [account.username]);

  return (
    <>
      <div ref={pageRef} className="page">
        <header className="page-header">
          <div className="page-header__left">
            <span className="page-header__brand">GitHub Collaboration Platform</span>
            <GlobalSearch />
          </div>
          <AccountMenu account={account} onSignOutRequest={() => setSignOutOpen(true)} />
        </header>
        <main>
          <h1>Workspace</h1>
          <p>
            Signed in as <a href="#/orgs">{account.username}</a>.
          </p>
          <nav className="landing__links" aria-label="Workspace">
            <a href={`#/u/${encodeURIComponent(account.username)}`}>Your repositories</a>
            <a href="#/repos/new">New repository</a>
          </nav>
          <WorkspaceRepositories repositories={repositories} />
        </main>
      </div>
      {signOutOpen && (
        <SignOutDialog
          onClose={() => {
            setSignOutOpen(false);
          }}
        />
      )}
    </>
  );
}
