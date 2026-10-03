import { useEffect, useState } from "react";

import { fetchPublicOrganizations, type OrganizationSummary } from "../api/organizations";
import type { Account } from "../api/auth";
import { useAuth } from "../auth/AuthProvider";
import { AppHeader } from "../components/AppHeader";
import { makeHash } from "../lib/hash-route";
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

function LandingPage() {
  return (
    <main>
      <h1>GitHub</h1>
      <p>Build, review, and ship software together.</p>
      <nav aria-label="Account access">
        <ul className="link-list">
          <li>
            <a href={makeHash("/signup")}>Sign up</a>
          </li>
          <li>
            <a href={makeHash("/signin")}>Sign in</a>
          </li>
          <li>
            <a href={makeHash("/forgot")}>Forgot password</a>
          </li>
        </ul>
      </nav>
      <PublicOrganizations />
    </main>
  );
}

export function WorkspacePage({ account }: { account: Account }) {
  return (
    <main>
      <AppHeader account={account} />
      <h1>Workspace</h1>
      <p className="workspace__account">
        Signed in as <span className="workspace__username">{account.username}</span>
      </p>
    </main>
  );
}

export function HomePage() {
  const { status, account } = useAuth();
  if (status === "loading") return <BusyPage />;
  if (account) return <WorkspacePage account={account} />;
  return <LandingPage />;
}
