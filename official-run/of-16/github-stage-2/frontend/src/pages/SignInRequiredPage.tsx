/**
 * Shown when a protected page is opened without a valid session, e.g. after
 * signing out and refreshing, navigating back or reopening the address
 * directly. It never restores the previous session and offers the "Sign in"
 * entry to authenticate again.
 */
export function SignInRequiredPage() {
  return (
    <section className="page page--narrow">
      <h1>Sign in required</h1>
      <p className="page__lead">This page needs an authenticated account. Sign in to continue.</p>
      <p className="page__links">
        <a href="#/login">Sign in</a>
      </p>
    </section>
  );
}
