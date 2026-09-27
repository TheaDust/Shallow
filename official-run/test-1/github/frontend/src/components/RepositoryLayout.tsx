import type { ReactNode } from 'react';
import type { RepositoryDetail } from '../api';
import { repoUrl } from '../repository';

export type RepoTab = 'code' | 'issues' | 'pulls' | 'settings';

export default function RepositoryLayout({
  repository,
  activeTab,
  children,
}: {
  repository: RepositoryDetail;
  activeTab: RepoTab;
  children: ReactNode;
}) {
  const { owner, name } = repository;
  return (
    <main className="repo-page">
      <div className="repo-title-row">
        <h1>
          {owner}/{name}
        </h1>
        <span className="visibility-badge">
          {repository.visibility === 'public' ? 'Public' : 'Private'}
        </span>
      </div>
      <p className="repo-description">{repository.description}</p>
      <p className="repo-meta">
        Default branch: <strong>{repository.defaultBranch}</strong>
      </p>
      <nav className="repo-tabs" aria-label="Repository">
        <a href={repoUrl(owner, name, '/code')} aria-current={activeTab === 'code' ? 'page' : undefined}>
          Code
        </a>
        <a href={repoUrl(owner, name, '/issues')} aria-current={activeTab === 'issues' ? 'page' : undefined}>
          Issues
        </a>
        <a href={repoUrl(owner, name, '/pulls')} aria-current={activeTab === 'pulls' ? 'page' : undefined}>
          Pull requests
        </a>
        <a href={repoUrl(owner, name, '/settings')} aria-current={activeTab === 'settings' ? 'page' : undefined}>
          Settings
        </a>
      </nav>
      {children}
    </main>
  );
}
