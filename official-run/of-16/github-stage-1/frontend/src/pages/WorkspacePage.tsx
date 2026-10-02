/**
 * Landing view for a signed-in visitor. The current account is shown by the
 * account menu in the top bar, so the username is rendered exactly once.
 */
export function WorkspacePage() {
  return (
    <section className="page">
      <h1>Workspace</h1>
      <p className="page__lead">
        Pick an organization from the account menu to browse its repositories, or continue with the
        work you left open.
      </p>
    </section>
  );
}
