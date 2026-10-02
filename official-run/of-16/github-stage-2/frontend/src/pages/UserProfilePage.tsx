import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { useSession } from "../auth/SessionContext";
import { fetchUserRepositories } from "../repositories/api";
import { repositoryPath } from "../repositories/routes";
import type { RepositoryOwnerList } from "../repositories/types";
import { visibilityLabel } from "../organizations/format";

export interface UserProfilePageProps {
  username: string;
}

/**
 * Personal profile page of one account: its public repositories and, for the
 * signed-in account itself, the "New repository" entry. A repository the viewer
 * may not read is never listed; an unknown account answers with the not-found
 * view instead of an empty profile.
 */
export function UserProfilePage({ username }: UserProfilePageProps) {
  const { account } = useSession();
  const [profile, setProfile] = useState<RepositoryOwnerList | null>(null);
  const [failure, setFailure] = useState<"notFound" | "failed" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setFailure(null);
    fetchUserRepositories(username)
      .then((next) => {
        if (!cancelled) setProfile(next);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) setFailure("notFound");
        else setFailure("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (failure === "notFound") {
    return (
      <section className="page page--narrow">
        <h1>User not found</h1>
        <p className="page__lead">The address does not match a registered account.</p>
      </section>
    );
  }

  if (failure === "failed") {
    return (
      <section className="page page--narrow">
        <p role="alert">We could not load this profile. Try again.</p>
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="page">
        <p role="status">Loading profile…</p>
      </section>
    );
  }

  return (
    <section className="page">
      <h1>{profile.owner.name}</h1>
      {account?.username === profile.owner.slug ? (
        <p className="page__links">
          <a href="#/new">New repository</a>
        </p>
      ) : null}
      <section aria-labelledby="user-repositories-heading">
        <h2 id="user-repositories-heading">Repositories</h2>
        {profile.repositories.length > 0 ? (
          <ul className="repository-list">
            {profile.repositories.map((repository) => (
              <li key={repository.name} className="repository-list__item">
                <a
                  className="repository-list__name"
                  href={`#${repositoryPath("account", profile.owner.slug, repository.name)}`}
                >
                  {repository.name}
                </a>
                <p className="repository-list__description">{repository.description}</p>
                <p className="repository-list__meta">
                  <span className="repository-list__visibility">{visibilityLabel(repository.visibility)}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="repository-list__branch">Default branch {repository.defaultBranch}</span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="repository-list__empty">This account has no repository yet.</p>
        )}
      </section>
    </section>
  );
}
