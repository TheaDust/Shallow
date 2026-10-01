import { useSession } from "../lib/session";
import { RepositoryList } from "../features/repositories/RepositoryList";
import { useReadableRepositories } from "../features/repositories/use-repository";

/** Signed-in landing page; requires the session created by REQ-1-1-2. */
export function WorkspacePage() {
  const { user, loading } = useSession();
  const repositories = useReadableRepositories(user?.username ?? null);

  if (loading) {
    return (
      <main className="workspace-page">
        <h1>Workspace</h1>
        <p role="status">Loading your workspace…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="workspace-page">
        <h1>Workspace</h1>
        <p>You need to sign in to view the workspace.</p>
        <p>
          <a href="#/sign-in">Sign in</a>
        </p>
      </main>
    );
  }

  return (
    <main className="workspace-page">
      <h1>Workspace</h1>
      <p>Your personal workspace is ready. Organizations and repositories you can access appear here.</p>
      <p className="workspace-page__create">
        <a href="#/new">New repository</a>
      </p>
      <p className="workspace-page__organizations">
        <a href="#/organizations">Your organizations</a>
      </p>
      <RepositoryList repositories={repositories} />
    </main>
  );
}
