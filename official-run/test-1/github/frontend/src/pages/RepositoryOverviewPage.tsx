import RepositoryLayout from '../components/RepositoryLayout';
import { blobUrl, treeUrl, useRepositoryDetail } from '../repository';

export default function RepositoryOverviewPage({
  owner,
  name,
}: {
  owner: string;
  name: string;
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
  return (
    <RepositoryLayout repository={repository} activeTab="code">
      <ul className="file-list">
        {repository.files.map((entry) => (
          <li key={entry.path}>
            {entry.type === 'directory' ? (
              <a
                className="file-entry"
                href={treeUrl(repository.owner, repository.name, repository.defaultBranch, entry.path)}
              >
                {entry.name}
              </a>
            ) : (
              <a
                className="file-entry"
                href={blobUrl(repository.owner, repository.name, repository.defaultBranch, entry.path)}
              >
                {entry.name}
              </a>
            )}
          </li>
        ))}
      </ul>
    </RepositoryLayout>
  );
}
