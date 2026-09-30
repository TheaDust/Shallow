/**
 * Rendered by protected pages when the current browser has no session: the
 * visitor sees the "Sign in" entry instead of protected content.
 */
export function SignInRequired() {
  return (
    <>
      <p>You must be signed in to view this page.</p>
      <p>
        <a href="#/signin">Sign in</a>
      </p>
    </>
  );
}
