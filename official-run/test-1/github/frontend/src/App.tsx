import { useEffect, useState } from 'react';
import { apiMe, apiSignOut } from './api';
import type { User } from './api';
import { matchRoute, navigate, useRoute } from './router';
import type { RouteMatch } from './router';
import HomePage from './pages/HomePage';
import SignInPage from './pages/SignInPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPage from './pages/ForgotPage';
import SettingsPage from './pages/SettingsPage';
import PasswordSettingsPage from './pages/PasswordSettingsPage';
import SearchPage from './pages/SearchPage';
import RepositoryOverviewPage from './pages/RepositoryOverviewPage';
import RepositoryTabPage from './pages/RepositoryTabPage';
import IssuesListPage from './pages/IssuesListPage';
import IssueDetailPage from './pages/IssueDetailPage';
import FileContentPage from './pages/FileContentPage';
import TreePage from './pages/TreePage';
import NotFoundPage from './pages/NotFoundPage';
import AccountMenu from './components/AccountMenu';
import GlobalSearch from './components/GlobalSearch';

type SessionState = User | 'loading' | null;

export default function App() {
  const [session, setSession] = useState<SessionState>('loading');
  const route = useRoute();
  const match = matchRoute(route.path);

  useEffect(() => {
    let cancelled = false;
    apiMe()
      .then(({ user }) => {
        if (!cancelled) setSession(user);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSignedIn(user: User) {
    setSession(user);
    navigate('/');
  }

  async function handleSignedOut() {
    try {
      await apiSignOut();
    } finally {
      setSession(null);
      navigate('/');
    }
  }

  function renderPage(pageMatch: RouteMatch) {
    switch (pageMatch.name) {
      case 'search':
        return <SearchPage />;
      case 'repositoryOverview':
        return (
          <RepositoryOverviewPage
            key={`${pageMatch.owner}/${pageMatch.repoName}`}
            owner={pageMatch.owner}
            name={pageMatch.repoName}
          />
        );
      case 'repositoryTab':
        if (pageMatch.tab === 'issues') {
          return (
            <IssuesListPage
              key={`${pageMatch.owner}/${pageMatch.repoName}/issues`}
              owner={pageMatch.owner}
              name={pageMatch.repoName}
              query={route.query}
            />
          );
        }
        return (
          <RepositoryTabPage
            key={`${pageMatch.owner}/${pageMatch.repoName}/${pageMatch.tab}`}
            owner={pageMatch.owner}
            name={pageMatch.repoName}
            tab={pageMatch.tab}
          />
        );
      case 'issueDetail':
        return (
          <IssueDetailPage
            key={`${pageMatch.owner}/${pageMatch.repoName}/${pageMatch.number}`}
            owner={pageMatch.owner}
            name={pageMatch.repoName}
            number={pageMatch.number}
          />
        );
      case 'file':
        return (
          <FileContentPage
            key={`${pageMatch.owner}/${pageMatch.repoName}/${pageMatch.branch}/${pageMatch.path}`}
            owner={pageMatch.owner}
            name={pageMatch.repoName}
            branch={pageMatch.branch}
            path={pageMatch.path}
          />
        );
      case 'tree':
        return (
          <TreePage
            key={`${pageMatch.owner}/${pageMatch.repoName}/${pageMatch.branch}/${pageMatch.path}`}
            owner={pageMatch.owner}
            name={pageMatch.repoName}
            branch={pageMatch.branch}
            path={pageMatch.path}
          />
        );
      case 'notFound':
        return <NotFoundPage />;
      default:
        return null;
    }
  }

  function renderContent() {
    if (session === 'loading') {
      return (
        <main className="home-page">
          <p>Loading…</p>
        </main>
      );
    }
    if (session) {
      // The recovery workflow stays reachable for signed-in users (REQ-1-1-3).
      if (route.path === '/forgot') {
        return <ForgotPage />;
      }
      if (match.name === 'settings') {
        return <SettingsPage />;
      }
      if (match.name === 'settingsPassword') {
        return <PasswordSettingsPage />;
      }
    }
    switch (match.name) {
      case 'signin':
        return session ? <HomePage session={session} /> : <SignInPage onSignedIn={handleSignedIn} />;
      case 'register':
        return session ? <HomePage session={session} /> : <RegisterPage />;
      case 'forgot':
        return <ForgotPage />;
      case 'search':
      case 'repositoryOverview':
      case 'repositoryTab':
      case 'issueDetail':
      case 'file':
      case 'tree':
      case 'notFound':
        return renderPage(match);
      default:
        return <HomePage session={session} />;
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          GitHub
        </a>
        <GlobalSearch query={route.path === '/search' ? route.query.get('q') || '' : ''} />
        {session && typeof session !== 'string' && (
          <AccountMenu user={session} onSignedOut={handleSignedOut} />
        )}
      </header>
      {renderContent()}
    </div>
  );
}
