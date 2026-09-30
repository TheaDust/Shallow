/**
 * Answer for a signed-in viewer who may not read an existing private
 * repository: the requirement asks for an explicit denial instead of the generic
 * "Page not found" of a repository nobody can confirm exists.
 */
export interface AccessDeniedPageProps {
  owner: string;
  name: string;
}

export function AccessDeniedPage({ owner, name }: AccessDeniedPageProps) {
  return (
    <main>
      <h1>Access denied</h1>
      <p>
        You do not have permission to view <strong>{`${owner}/${name}`}</strong>.
      </p>
      <p>Ask a repository administrator or an organization Owner for access.</p>
    </main>
  );
}
