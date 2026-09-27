import { useEffect, useState } from 'react';
import { apiSearchRepositories } from '../api';
import type { RepositorySummary } from '../api';
import { formatUpdatedAt } from '../repository';
import { useRoute } from '../router';

export const SEARCH_FILTERS = ['All', 'Repositories', 'Code', 'Issues', 'Pull requests'];

function repoResultUrl(owner: string, name: string): string {
  return `#/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export default function SearchPage() {
  const route = useRoute();
  const q = route.query.get('q') || '';
  const typeParam = route.query.get('type') || 'All';
  const type = SEARCH_FILTERS.includes(typeParam) ? typeParam : 'All';
  const showRepositories = type === 'All' || type === 'Repositories';

  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; results: RepositorySummary[] }
    | { status: 'error' }
  >({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    if (!q || !showRepositories) {
      setState({ status: 'ready', results: [] });
      return;
    }
    apiSearchRepositories(q)
      .then(({ results }) => {
        if (!cancelled) setState({ status: 'ready', results });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [q, type, showRepositories, attempt]);

  return (
    <main className="search-page">
      <h1>Search results</h1>
      <nav className="search-filters" aria-label="Search type">
        {SEARCH_FILTERS.map((filter) => (
          <a
            key={filter}
            href={`#/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(filter)}`}
            aria-current={type === filter ? 'page' : undefined}
          >
            {filter}
          </a>
        ))}
      </nav>

      {state.status === 'loading' && <p>Loading…</p>}

      {state.status === 'error' && (
        <div role="alert">
          <p className="form-error">Search failed. Please try again.</p>
          <button type="button" className="secondary-button" onClick={() => setAttempt((v) => v + 1)}>
            Retry
          </button>
        </div>
      )}

      {state.status === 'ready' && state.results.length === 0 && <p className="muted">No results</p>}

      {state.status === 'ready' && state.results.length > 0 && (
        <div className="search-results">
          {state.results.map((result) => (
            <article className="search-result" key={`${result.owner}/${result.name}`}>
              <h2 className="search-result-title">
                <a href={repoResultUrl(result.owner, result.name)}>{result.name}</a>
              </h2>
              <p className="search-result-meta">
                {result.owner}/{result.name}
              </p>
              {result.description && <p className="search-result-description">{result.description}</p>}
              <p className="search-result-meta">
                <span>{result.visibility === 'public' ? 'Public' : 'Private'}</span>
                {' · Updated '}
                {formatUpdatedAt(result.updatedAt)}
              </p>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
