import { useEffect, useState } from "react";

import { useSession } from "../auth/SessionContext";
import { fetchOrganizationDirectory } from "../organizations/api";
import type { Organization } from "../organizations/types";
import { WorkspacePage } from "./WorkspacePage";

/**
 * Visitor entry to the public organization pages: every organization is listed
 * with a link to its overview, where its public repositories can be browsed
 * without an account.
 */
function OrganizationDirectory() {
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOrganizationDirectory()
      .then((next) => {
        if (!cancelled) setOrganizations(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="page-section" aria-labelledby="organization-directory-heading">
      <h2 id="organization-directory-heading">Explore organizations</h2>
      <p className="page__lead">
        Open a public organization page to browse the repositories its members share publicly.
      </p>
      {failed ? (
        <p className="app-form__error" role="alert">
          We could not load the organizations. Try again.
        </p>
      ) : null}
      {!failed && organizations === null ? <p role="status">Loading organizations…</p> : null}
      {organizations !== null ? (
        organizations.length > 0 ? (
          <ul className="organization-directory">
            {organizations.map((organization) => (
              <li key={organization.slug} className="organization-directory__item">
                <a className="organization-directory__name" href={`#/organizations/${organization.slug}`}>
                  {organization.displayName}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="organization-directory__empty">No organization has a public page yet.</p>
        )
      ) : null}
    </section>
  );
}

/**
 * Home page. The account-access entries ("Sign up", "Sign in", "Forgot
 * password") stay available so a signed-in visitor can always open the sign-in
 * form again; signed-in visitors additionally land on their workspace, while
 * visitors can discover the public organization pages.
 */
export function HomePage() {
  const { account } = useSession();

  return (
    <>
      {account ? (
        <WorkspacePage />
      ) : (
        <section className="page">
          <h1>Collaborate on code</h1>
          <p className="page__lead">
            ShallowCode is a simplified collaboration platform: plan work, review changes and keep
            repositories healthy together with your team.
          </p>
        </section>
      )}
      {account ? null : <OrganizationDirectory />}
      <nav className="account-access" aria-label="Account access">
        <a href="#/signup">Sign up</a>
        <a href="#/login">Sign in</a>
        <a href="#/forgot-password">Forgot password</a>
      </nav>
    </>
  );
}
