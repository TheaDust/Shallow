import RepositoryLayout from '../components/RepositoryLayout';
import { repoUrl, useRepositoryDetail } from '../repository';

export default function RepositoryTabPage({
  owner,
  name,
  tab,
}: {
  owner: string;
  name: string;
  tab: 'issues' | 'pulls' | 'settings' | 'general';
}) {
  const { state, reload } = useRepositoryDetail(owner, name);

  if (state.status === 'loading') {
    return (
      <main className="repo-page">
        <p>Loading…</p>
      </main>
    );
  }

  if (state.status === 'notFound') {
    return (
      <main className="repo-page">
        <h1>Repository not found</h1>
        <p className="muted">The repository does not exist or you do not have access to it.</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="repo-page">
        <div role="alert">
          <p className="form-error">Repository could not be loaded. Please try again.</p>
          <button type="button" className="secondary-button" onClick={reload}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  const repository = state.repository;
  const activeTab = tab === 'general' ? 'settings' : tab;

  return (
    <RepositoryLayout repository={repository} activeTab={activeTab}>
      {tab === 'pulls' && (
        <section>
          <h2>Pull requests</h2>
          <p className="muted">No pull requests</p>
        </section>
      )}
      {tab === 'settings' && (
        <section>
          <h2>Settings</h2>
          <nav className="repo-settings-nav" aria-label="Repository settings">
            <a href={repoUrl(owner, name, '/settings/general')}>General</a>
          </nav>
        </section>
      )}
      {tab === 'general' && (
        <section>
          <h2>General</h2>
        </section>
      )}
    </RepositoryLayout>
  );
}
