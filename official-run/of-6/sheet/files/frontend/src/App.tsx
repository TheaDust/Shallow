import { useEffect, useState } from 'react';
import HomePage from './pages/HomePage';
import EditorPage from './pages/EditorPage';
import CreateWorkbookPage from './pages/CreateWorkbookPage';

function readPath(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash.split('?')[0];
}

export default function App() {
  const [path, setPath] = useState<string>(readPath);

  useEffect(() => {
    const onHashChange = () => {
      setPath(readPath());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (path.startsWith('/workbook/')) {
    const id = decodeURIComponent(path.slice('/workbook/'.length));
    return <EditorPage key={id} workbookId={id} />;
  }
  if (path === '/new') {
    return <CreateWorkbookPage />;
  }
  return <HomePage />;
}
