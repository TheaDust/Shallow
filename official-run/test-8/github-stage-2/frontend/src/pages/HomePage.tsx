import { useEffect, useState } from "react";

import {
  fetchPublicOrganizations,
  fetchPublicRepositories,
  fetchYourRepositories,
  type OrganizationSummary,
  type RepositorySummary,
} from "../api/organizations";
import type { Account } from "../api/auth";
import { useAuth } from "../auth/AuthProvider";
import { RepositoryEntries } from "../components/RepositoryEntries";
import { SiteHeader } from "../components/SiteHeader";
import { makeHash } from "../lib/hash-route";
import { useAsyncData } from "../lib/useAsyncData";
import { BusyPage } from "./StatusPages";

function PublicOrganizations() {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchPublicOrganizations()
      .then((result) => {
        if (!cancelled) setOrganizations(result.organizations);
      })
      .catch(() => {
        if (!cancelled) setOrganizations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (organizations.length === 0) return null;

  return (
    <section className="public-organizations" aria-labelledby="public-organizations-heading">
      <h2 id="public-organizations-heading">Explore organizations</h2>
      <ul className="organization-list">
        {organizations.map((organization) => (
          <li key={organization.id}>
            <a href={makeHash(`/organizations/${organization.slug}`)}>{organization.displayName}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The landing page lists the public repositories a visitor may open; the server
 * decides the set, so an ungranted private repository never appears here.
 */
function PublicRepositories() {
  const { data } = useAsyncData(() => fetchPublicRepositories(), []);
  const repositories = data?.repositories ?? [];
  if (repositories.length === 0) return null;

  return (
    <section className="public-repositories" aria-labelledby="public-repositories-heading">
      <h2 id="public-repositories-heading">Explore repositories</h2>
      <RepositoryEntries repositories={repositories} />
    </section>
  );
}

function LandingPage() {
  return (
    <main>
      <SiteHeader account={null} />
      <h1>GitHub</h1>
      <p>Build, review, and ship software together.</p>
      <nav aria-label="Account access">
        <ul className="link-list">
          <li>
            <a href={makeHash("/signup")}>Sign up</a>
          </li>
          <li>
            <a href={makeHash("/forgot")}>Forgot password</a>
          </li>
        </ul>
      </nav>
      <PublicRepositories />
      <PublicOrganizations />
    </main>
  );
}

/**
 * Signed-in home. Besides the account it lists the repositories the account may
 * read anywhere — a direct grant reaches one without any organization
 * membership — so the overview stays reachable from the home page.
 */
export function WorkspacePage({ account }: { account: Account }) {
  const { data } = useAsyncData(() => fetchYourRepositories(), [account.id]);
  const repositories: RepositorySummary[] = data?.repositories ?? [];

  return (
    <main>
      <SiteHeader account={account} />
      <h1>Workspace</h1>
      <p>
        <a href={makeHash("/repositories/new")}>New repository</a>
      </p>
      <p className="workspace__account">
        Signed in as <span className="workspace__username">{account.username}</span>
      </p>
      {repositories.length > 0 ? (
        <section className="workspace-repositories" aria-labelledby="workspace-repositories-heading">
          <h2 id="workspace-repositories-heading">Repositories</h2>
          <RepositoryEntries repositories={repositories} />
        </section>
      ) : null}
    </main>
  );
}

export function HomePage() {
  const { status, account } = useAuth();
  if (status === "loading") return <BusyPage />;
  if (account) return <WorkspacePage account={account} />;
  return <LandingPage />;
}
