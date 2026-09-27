import { useEffect, useState } from 'react';
import { apiFileContent, isApiError } from '../api';
import type { FileContent } from '../api';

export default function FileContentPage({
  owner,
  name,
  branch,
  path,
}: {
  owner: string;
  name: string;
  branch: string;
  path: string;
}) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; file: FileContent }
    | { status: 'notFound' }
    | { status: 'error' }
  >({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    apiFileContent(owner, name, path)
      .then(({ file }) => {
        if (!cancelled) setState({ status: 'ready', file });
      })
      .catch((err) => {
        if (cancelled) return;
        if (isApiError(err) && err.status === 404) {
          setState({ status: 'notFound' });
        } else {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, path, attempt]);

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
        <h1>File not found</h1>
        <p className="muted">The file does not exist or you do not have access to it.</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="repo-page">
        <div role="alert">
          <p className="form-error">File could not be loaded. Please try again.</p>
          <button type="button" className="secondary-button" onClick={() => setAttempt((v) => v + 1)}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  const file = state.file;
  return (
    <main className="repo-page">
      <nav className="file-breadcrumb" aria-label="Breadcrumb">
        <a href={`#/${encodeURIComponent(file.owner)}/${encodeURIComponent(file.name)}/code`}>
          {file.owner}/{file.name}
        </a>
        <span aria-hidden="true">/</span>
        <span>{branch}</span>
        <span aria-hidden="true">/</span>
        <span>{file.path}</span>
      </nav>
      <h1>{file.fileName}</h1>
      <pre className="file-content">{file.content}</pre>
    </main>
  );
}
