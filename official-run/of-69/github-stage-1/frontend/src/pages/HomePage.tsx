import { AppHeader } from "../components/AppHeader";
import { fetchPublicOrganizations } from "../lib/organization-api";
import { organizationUrl } from "../lib/routes";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";

export function HomePage() {
  const { account } = useSession();
  const organizations = useAsyncData(fetchPublicOrganizations, []);

  return (
    <div className="app-shell">
      {account ? <AppHeader username={account.username} /> : null}
      <main>
        <h1>GitHub</h1>
        <p className="home-tagline">A simplified collaboration platform for repositories and teams.</p>
        <nav className="home-links" aria-label="Account access">
          <a href="#/signup">Sign up</a>
          <a href="#/signin">Sign in</a>
          <a href="#/recover">Forgot password</a>
        </nav>
        <section className="home-organizations" aria-labelledby="home-organizations-heading">
          <h2 id="home-organizations-heading">Explore organizations</h2>
          {organizations.loading ? (
            <p role="status">Loading organizations…</p>
          ) : organizations.data && organizations.data.length > 0 ? (
            <ul className="organization-list">
              {organizations.data.map((organization) => (
                <li key={organization.name}>
                  <a href={organizationUrl(organization.name)}>{organization.displayName}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No public organizations yet.</p>
          )}
        </section>
      </main>
    </div>
  );
}
