import type { Account } from "../api/auth";
import { SiteHeader } from "../components/SiteHeader";
import { makeHash } from "../lib/hash-route";

export function SettingsPage({ account }: { account: Account }) {
  return (
    <main>
      <SiteHeader account={account} />
      <h1>Settings</h1>
      <nav className="settings-nav" aria-label="Settings">
        <ul className="link-list">
          <li>
            <a href={makeHash("/settings/password")}>Password and authentication</a>
          </li>
        </ul>
      </nav>
      <section className="settings-section" aria-labelledby="settings-account-heading">
        <h2 id="settings-account-heading">Account</h2>
        <dl className="settings-details">
          <dt>Username</dt>
          <dd>{account.username}</dd>
          <dt>Email</dt>
          <dd>{account.email}</dd>
          <dt>Email status</dt>
          <dd>{account.emailVerified ? "Verified" : "Unverified"}</dd>
        </dl>
      </section>
    </main>
  );
}
