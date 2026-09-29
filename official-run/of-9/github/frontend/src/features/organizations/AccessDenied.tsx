import { useSession } from "../auth/session";

export function AccessDenied() {
  const { session } = useSession();
  return (
    <section className="access-denied">
      <h1>Access denied</h1>
      <p>You do not have permission to view this resource.</p>
      {session.status === "anonymous" ? (
        <nav className="access-denied__actions" aria-label="Account access">
          <a href="#/signin">Sign in</a>
        </nav>
      ) : null}
    </section>
  );
}
