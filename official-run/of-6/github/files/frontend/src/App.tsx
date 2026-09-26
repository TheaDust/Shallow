import { useCallback, useEffect, useState } from 'react';
import { SessionContext } from './session';
import type { AuthState, SessionUser } from './types';
import { useHashRoute, navigate } from './router';
import { apiSession, apiSignOut } from './api';
import AccountMenu from './components/AccountMenu';
import GlobalSearch from './components/GlobalSearch';
import RepositorySearch from './components/RepositorySearch';
import HomePage from './pages/HomePage';
import SignInPage from './pages/SignInPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import WorkspacePage from './pages/WorkspacePage';
import SettingsPage from './pages/SettingsPage';
import PasswordSettingsPage from './pages/PasswordSettingsPage';
import YourOrganizationsPage from './pages/YourOrganizationsPage';
import CreateOrganizationPage from './pages/CreateOrganizationPage';
import OrganizationPage from './pages/OrganizationPage';
import type { OrganizationTab } from './pages/OrganizationPage';
import NewTeamPage from './pages/NewTeamPage';
import TeamPage from './pages/TeamPage';
import type { TeamTab } from './pages/TeamPage';
import RepositoryOverviewPage from './pages/RepositoryOverviewPage';
import RepositorySettingsPage from './pages/RepositorySettingsPage';
import RepositoryBranchesSettingsPage from './pages/RepositoryBranchesSettingsPage';
import ManageAccessPage from './pages/ManageAccessPage';
import SearchResultsPage from './pages/SearchResultsPage';
import CreateRepositoryPage from './pages/CreateRepositoryPage';
import ForkRepositoryPage from './pages/ForkRepositoryPage';
import CommitsPage from './pages/CommitsPage';
import CommitDetailPage from './pages/CommitDetailPage';
import CommitFileDiffPage from './pages/CommitFileDiffPage';
import ComparePage from './pages/ComparePage';
import CompareDiffPage from './pages/CompareDiffPage';
import CompareFileDiffPage from './pages/CompareFileDiffPage';
import FileContentPage from './pages/FileContentPage';
import FileEditorPage from './pages/FileEditorPage';
import DirectoryPage from './pages/DirectoryPage';
import RepositoryCodeSearchPage from './pages/RepositoryCodeSearchPage';
import IssuesPage from './pages/IssuesPage';
import IssueDetailPage from './pages/IssueDetailPage';
import NewIssuePage from './pages/NewIssuePage';
import PullRequestsPage from './pages/PullRequestsPage';
import PullRequestDetailPage from './pages/PullRequestDetailPage';
import PullRequestComparePage from './pages/PullRequestComparePage';

function NotFoundPage() {
  return (
    <div className="not-found-page">
      <h1>Page not found</h1>
    </div>
  );
}

interface RouteMatch {
  page: string;
  params: Record<string, string>;
  tab?: OrganizationTab;
  teamTab?: TeamTab;
}

/**
 * Splits a hash route into a page name plus parameters. All application
 * routes live under `#/...`; parameter segments are decoded so org/repo
 * identifiers with hyphens work unchanged.
 */
export function matchRoute(route: string): RouteMatch {
  // The search route carries its query in the hash query string
  // (#/search?q=...&type=...); every other route is plain segments.
  const queryIndex = route.indexOf('?');
  const pathPart = queryIndex === -1 ? route : route.slice(0, queryIndex);
  const searchParams = new URLSearchParams(
    queryIndex === -1 ? '' : route.slice(queryIndex + 1)
  );
  const segments = pathPart
    .replace(/^#\/?/, '')
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => decodeURIComponent(s));

  if (segments.length === 0) {
    return { page: 'home', params: {} };
  }
  if (segments[0] === 'search') {
    return {
      page: 'search',
      params: {
        q: searchParams.get('q') ?? '',
        type: searchParams.get('type') ?? 'repositories',
      },
    };
  }
  if (segments[0] === 'signin') {
    return { page: 'signin', params: {} };
  }
  if (segments[0] === 'register') {
    return { page: 'register', params: {} };
  }
  if (segments[0] === 'forgot') {
    return { page: 'forgot', params: {} };
  }
  if (segments[0] === 'workspace') {
    return { page: 'workspace', params: {} };
  }
  if (segments[0] === 'settings' && segments.length === 1) {
    return { page: 'settings', params: {} };
  }
  if (segments[0] === 'settings' && segments[1] === 'password') {
    return { page: 'settings-password', params: {} };
  }
  if (segments[0] === 'organizations' && segments.length === 1) {
    return { page: 'organizations', params: {} };
  }
  if (segments[0] === 'new-organization') {
    return { page: 'new-organization', params: {} };
  }
  if (segments[0] === 'new-repository') {
    return { page: 'new-repository', params: {} };
  }
  if (segments[0] === 'organizations' && segments.length === 2) {
    return { page: 'organization', params: { name: segments[1] }, tab: 'repositories' };
  }
  if (segments[0] === 'organizations' && segments.length === 3) {
    if (segments[2] === 'people' || segments[2] === 'teams') {
      return {
        page: 'organization',
        params: { name: segments[1] },
        tab: segments[2] as OrganizationTab,
      };
    }
  }
  if (segments[0] === 'organizations' && segments.length === 4 && segments[2] === 'teams') {
    if (segments[3] === 'new') {
      // The create-team page reuses the teams route family; a team literally
      // named "new" cannot be opened inside this organization via /teams/new.
      return { page: 'new-team', params: { name: segments[1] } };
    }
    return {
      page: 'team',
      params: { name: segments[1], team: segments[3] },
      teamTab: 'members',
    };
  }
  if (
    segments[0] === 'organizations' &&
    segments.length === 5 &&
    segments[2] === 'teams' &&
    (segments[4] === 'members' || segments[4] === 'settings')
  ) {
    return {
      page: 'team',
      params: { name: segments[1], team: segments[3] },
      teamTab: segments[4] as TeamTab,
    };
  }
  if (segments[0] === 'repositories' && segments.length === 3) {
    return { page: 'repository', params: { owner: segments[1], name: segments[2] } };
  }
  if (segments[0] === 'repositories' && segments.length === 4 && segments[3] === 'issues') {
    // REQ-5-1-1: the Issues list page of the repository. The chosen filter
    // context (state, keyword, label) travels in the hash query string so a
    // reload keeps the filters and the matching rows.
    return {
      page: 'repository-issues',
      params: {
        owner: segments[1],
        name: segments[2],
        state: searchParams.get('state') ?? '',
        q: searchParams.get('q') ?? '',
        label: searchParams.get('label') ?? '',
      },
    };
  }
  if (segments[0] === 'repositories' && segments.length === 4 && segments[3] === 'pulls') {
    // REQ-6-1/REQ-6-2-1: the Pull requests list page of the repository
    // (number, title, author, source/target branches, status). The chosen
    // filter context (status, author keyword, review status) travels in the
    // hash query string so a reload keeps the filters and the matching rows.
    return {
      page: 'repository-pulls',
      params: {
        owner: segments[1],
        name: segments[2],
        state: searchParams.get('state') ?? '',
        author: searchParams.get('author') ?? '',
        review: searchParams.get('review') ?? '',
      },
    };
  }
  if (segments[0] === 'repositories' && segments.length === 5 && segments[3] === 'pulls') {
    if (segments[4] === 'new') {
      // REQ-6-2-2: the read-only PR comparison page shown before creation.
      // The literal route `pulls/new` is checked before the numbered PR
      // detail route so it cannot collide with a numeric PR number; the
      // chosen base/compare branches travel in the hash query string so a
      // direct comparison-page entry opens with the branches already
      // selected and re-runs the same usable creation flow.
      return {
        page: 'repository-pull-compare',
        params: {
          owner: segments[1],
          name: segments[2],
          base: searchParams.get('base') ?? '',
          compare: searchParams.get('compare') ?? '',
        },
      };
    }
    // REQ-6-1: the pull request detail page of one repository-scoped number.
    // Conversation, Commits, Files changed, and Checks are navigation links
    // (tabs); the active tab travels in the hash query string so a reload
    // keeps it.
    return {
      page: 'repository-pull',
      params: {
        owner: segments[1],
        name: segments[2],
        number: segments[4],
        tab: searchParams.get('tab') ?? 'conversation',
      },
    };
  }
  if (segments[0] === 'repositories' && segments.length === 5 && segments[3] === 'issues') {
    if (segments[4] === 'new') {
      // REQ-5-2-1: the repository issue creation form. The literal route
      // `issues/new` is checked before the numbered issue-detail route so it
      // cannot collide with a numeric issue number.
      return {
        page: 'repository-new-issue',
        params: { owner: segments[1], name: segments[2] },
      };
    }
    // REQ-5-1-1: the issue detail page of one persisted issue number in the
    // repository.
    return {
      page: 'repository-issue',
      params: { owner: segments[1], name: segments[2], number: segments[4] },
    };
  }
  if (segments[0] === 'repositories' && segments.length === 4 && segments[3] === 'fork') {
    // REQ-3-2-2: the fork-a-repository form of a readable source repository.
    return { page: 'repository-fork', params: { owner: segments[1], name: segments[2] } };
  }
  if (segments[0] === 'repositories' && segments.length === 4 && segments[3] === 'search') {
    // REQ-4-2-3: repository-scoped code search results. The query, path, and
    // language filters travel in the hash query string so reloads and
    // re-searches keep the repository scope and filters unchanged.
    return {
      page: 'repository-code-search',
      params: {
        owner: segments[1],
        name: segments[2],
        q: searchParams.get('q') ?? '',
        path: searchParams.get('path') ?? '',
        lang: searchParams.get('lang') ?? '',
      },
    };
  }
  if (segments[0] === 'repositories' && segments.length === 4 && segments[3] === 'settings') {
    return { page: 'repository-settings', params: { owner: segments[1], name: segments[2] } };
  }
  if (segments[0] === 'repositories' && segments.length === 4 && segments[3] === 'commits') {
    return { page: 'repository-commits', params: { owner: segments[1], name: segments[2] } };
  }
  if (segments[0] === 'repositories' && segments.length >= 5 && segments[3] === 'commits') {
    // REQ-4-2-1: `commits/:branch` is the branch history and
    // `commits/:branch/:path...` is the file-scoped history of that path.
    return {
      page: 'repository-commits',
      params: {
        owner: segments[1],
        name: segments[2],
        branch: segments[4],
        path: segments.slice(5).join('/'),
      },
    };
  }
  if (segments[0] === 'repositories' && segments.length === 5 && segments[3] === 'commit') {
    // REQ-4-2-1: the commit detail page of one commit in the repository.
    return {
      page: 'repository-commit',
      params: { owner: segments[1], name: segments[2], commitId: segments[4] },
    };
  }
  if (segments[0] === 'repositories' && segments.length >= 6 && segments[3] === 'commit') {
    // REQ-4-2-2: the line-by-line diff of one changed file of a commit
    // (compared against its parent). The path may contain slashes.
    return {
      page: 'repository-commit-file',
      params: {
        owner: segments[1],
        name: segments[2],
        commitId: segments[4],
        file: segments.slice(5).join('/'),
      },
    };
  }
  if (segments[0] === 'repositories' && segments.length === 4 && segments[3] === 'compare') {
    // REQ-4-2-2: the comparison page (select base and compare, click Compare).
    return { page: 'repository-compare', params: { owner: segments[1], name: segments[2] } };
  }
  if (segments[0] === 'repositories' && segments.length === 6 && segments[3] === 'compare') {
    // REQ-4-2-2: the diff page between a base and a compare commit.
    return {
      page: 'repository-compare-diff',
      params: {
        owner: segments[1],
        name: segments[2],
        base: segments[4],
        compare: segments[5],
      },
    };
  }
  if (segments[0] === 'repositories' && segments.length >= 7 && segments[3] === 'compare') {
    // REQ-4-2-2: the line-by-line diff of one changed file of a comparison.
    return {
      page: 'repository-compare-file',
      params: {
        owner: segments[1],
        name: segments[2],
        base: segments[4],
        compare: segments[5],
        file: segments.slice(6).join('/'),
      },
    };
  }
  if (
    segments[0] === 'repositories' &&
    segments.length === 5 &&
    segments[3] === 'settings' &&
    segments[4] === 'access'
  ) {
    return { page: 'repository-access', params: { owner: segments[1], name: segments[2] } };
  }
  if (
    segments[0] === 'repositories' &&
    segments.length === 5 &&
    segments[3] === 'settings' &&
    segments[4] === 'branches'
  ) {
    // REQ-4-3-3: the “Branches” tab of repository settings, reached from the
    // Settings page's unique “Branches” link.
    return {
      page: 'repository-settings-branches',
      params: { owner: segments[1], name: segments[2] },
    };
  }
  if (segments[0] === 'repositories' && segments.length === 5 && segments[3] === 'new') {
    // REQ-4-4: the create-new-file editor opened from the Code page's
    // “Add file” → “Create new file” menuitem; the branch is the current
    // branch of the Code page.
    return {
      page: 'repository-new-file',
      params: { owner: segments[1], name: segments[2], branch: segments[4] },
    };
  }
  if (segments[0] === 'repositories' && segments.length >= 5 && segments[3] === 'edit') {
    // REQ-4-4: the edit-file editor opened from the file page's Edit entry;
    // the path is everything after the branch segment (may contain slashes).
    return {
      page: 'repository-edit-file',
      params: {
        owner: segments[1],
        name: segments[2],
        branch: segments[4],
        file: segments.slice(5).join('/'),
      },
    };
  }
  if (segments[0] === 'repositories' && segments.length >= 5 && segments[3] === 'blob') {
    // REQ-4-1: the file page. The path is everything after the branch
    // segment (may contain slashes, either encoded in one segment or split).
    return {
      page: 'repository-file',
      params: {
        owner: segments[1],
        name: segments[2],
        branch: segments[4],
        file: segments.slice(5).join('/'),
      },
    };
  }
  if (segments[0] === 'repositories' && segments.length >= 5 && segments[3] === 'tree') {
    // REQ-4-1: the directory page. '' path means the branch root.
    return {
      page: 'repository-tree',
      params: {
        owner: segments[1],
        name: segments[2],
        branch: segments[4],
        path: segments.slice(5).join('/'),
      },
    };
  }
  return { page: 'not-found', params: {} };
}

function renderRoute(route: string) {
  const match = matchRoute(route);
  switch (match.page) {
    case 'signin':
      return <SignInPage />;
    case 'register':
      return <RegisterPage />;
    case 'forgot':
      return <ForgotPasswordPage />;
    case 'workspace':
      return <WorkspacePage />;
    case 'settings':
      return <SettingsPage />;
    case 'settings-password':
      return <PasswordSettingsPage />;
    case 'organizations':
      return <YourOrganizationsPage />;
    case 'new-organization':
      return <CreateOrganizationPage />;
    case 'new-repository':
      return <CreateRepositoryPage />;
    case 'organization':
      return <OrganizationPage name={match.params.name} tab={match.tab ?? 'repositories'} />;
    case 'new-team':
      return <NewTeamPage name={match.params.name} />;
    case 'team':
      return (
        <TeamPage
          name={match.params.name}
          team={match.params.team}
          tab={match.teamTab ?? 'members'}
        />
      );
    case 'repository':
      return <RepositoryOverviewPage owner={match.params.owner} name={match.params.name} />;
    case 'repository-issues':
      return (
        <IssuesPage
          owner={match.params.owner}
          name={match.params.name}
          state={match.params.state ?? ''}
          query={match.params.q ?? ''}
          label={match.params.label ?? ''}
        />
      );
    case 'repository-issue':
      return (
        <IssueDetailPage
          owner={match.params.owner}
          name={match.params.name}
          number={Number(match.params.number)}
        />
      );
    case 'repository-pulls':
      return (
        <PullRequestsPage
          owner={match.params.owner}
          name={match.params.name}
          state={match.params.state ?? ''}
          author={match.params.author ?? ''}
          review={match.params.review ?? ''}
        />
      );
    case 'repository-pull':
      return (
        <PullRequestDetailPage
          owner={match.params.owner}
          name={match.params.name}
          number={Number(match.params.number)}
          tab={match.params.tab ?? 'conversation'}
        />
      );
    case 'repository-pull-compare':
      return (
        <PullRequestComparePage
          owner={match.params.owner}
          name={match.params.name}
          baseParam={match.params.base ?? ''}
          compareParam={match.params.compare ?? ''}
        />
      );
    case 'repository-new-issue':
      return (
        <NewIssuePage owner={match.params.owner} name={match.params.name} />
      );
    case 'repository-fork':
      return <ForkRepositoryPage owner={match.params.owner} name={match.params.name} />;
    case 'repository-settings':
      return <RepositorySettingsPage owner={match.params.owner} name={match.params.name} />;
    case 'repository-settings-branches':
      return (
        <RepositoryBranchesSettingsPage
          owner={match.params.owner}
          name={match.params.name}
        />
      );
    case 'repository-access':
      return <ManageAccessPage owner={match.params.owner} name={match.params.name} />;
    case 'repository-commits':
      return (
        <CommitsPage
          owner={match.params.owner}
          name={match.params.name}
          branch={match.params.branch ?? ''}
          path={match.params.path ?? ''}
        />
      );
    case 'repository-commit':
      return (
        <CommitDetailPage
          owner={match.params.owner}
          name={match.params.name}
          commitId={match.params.commitId}
        />
      );
    case 'repository-commit-file':
      return (
        <CommitFileDiffPage
          owner={match.params.owner}
          name={match.params.name}
          commitId={match.params.commitId}
          file={match.params.file}
        />
      );
    case 'repository-compare':
      return <ComparePage owner={match.params.owner} name={match.params.name} />;
    case 'repository-compare-diff':
      return (
        <CompareDiffPage
          owner={match.params.owner}
          name={match.params.name}
          base={match.params.base}
          compare={match.params.compare}
        />
      );
    case 'repository-compare-file':
      return (
        <CompareFileDiffPage
          owner={match.params.owner}
          name={match.params.name}
          base={match.params.base}
          compare={match.params.compare}
          file={match.params.file}
        />
      );
    case 'repository-file':
      return (
        <FileContentPage
          owner={match.params.owner}
          name={match.params.name}
          branch={match.params.branch}
          file={match.params.file}
        />
      );
    case 'repository-new-file':
      return (
        <FileEditorPage
          owner={match.params.owner}
          name={match.params.name}
          branch={match.params.branch}
          path=""
          mode="create"
        />
      );
    case 'repository-edit-file':
      return (
        <FileEditorPage
          owner={match.params.owner}
          name={match.params.name}
          branch={match.params.branch}
          path={match.params.file ?? ''}
          mode="edit"
        />
      );
    case 'repository-tree':
      return (
        <DirectoryPage
          owner={match.params.owner}
          name={match.params.name}
          branch={match.params.branch}
          path={match.params.path ?? ''}
        />
      );
    case 'repository-code-search':
      return (
        <RepositoryCodeSearchPage
          owner={match.params.owner}
          name={match.params.name}
          query={match.params.q ?? ''}
          path={match.params.path ?? ''}
          language={match.params.lang ?? ''}
        />
      );
    case 'search':
      return (
        <SearchResultsPage
          query={match.params.q ?? ''}
          type={match.params.type ?? 'repositories'}
        />
      );
    case 'home':
      return <HomePage />;
    default:
      return <NotFoundPage />;
  }
}

export default function App() {
  const route = useHashRoute();
  const routeMatch = matchRoute(route);
  // The global search box mirrors the active search query so clearing the term
  // on the results page navigates to an empty query instead of stale results.
  // REQ-4-2-3: on the repository code-search page the repository-scoped search
  // box mirrors the active query so the exact term is retained in Search.
  const searchQuery =
    routeMatch.page === 'search' || routeMatch.page === 'repository-code-search'
      ? (routeMatch.params.q ?? '')
      : '';
  const [auth, setAuth] = useState<AuthState>({ status: 'loading', user: null });

  const refresh = useCallback(async () => {
    try {
      const result = await apiSession();
      if (result.authenticated) {
        setAuth({ status: 'ready', user: { username: result.username, email: result.email } });
      } else {
        setAuth({ status: 'ready', user: null });
      }
    } catch {
      setAuth({ status: 'ready', user: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateUser = useCallback((user: SessionUser | null) => {
    setAuth({ status: 'ready', user });
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await apiSignOut();
    } catch {
      // Local sign-out still proceeds if the server is unreachable.
    }
    updateUser(null);
    navigate('#/');
  }, [updateUser]);

  return (
    <SessionContext.Provider value={{ auth, refresh, updateUser }}>
      <div className="app-shell">
        <header className="app-header">
          <a className="brand" href="#/">
            GitHub Collaboration Platform
          </a>
          <div className="header-search-slot">
            {/* REQ-4-2-3: repository pages expose one searchbox named "Search"
                that is scoped to the current repository and lands on its code
                results; every other page keeps the global repository search. */}
            {routeMatch.page.startsWith('repository') &&
            routeMatch.params.owner &&
            routeMatch.params.name ? (
              <RepositorySearch
                owner={routeMatch.params.owner}
                name={routeMatch.params.name}
                query={searchQuery}
              />
            ) : (
              <GlobalSearch query={searchQuery} />
            )}
          </div>
          <div className="header-account-slot">
            {auth.status === 'ready' && auth.user ? (
              <AccountMenu user={auth.user} onSignOut={handleSignOut} />
            ) : null}
          </div>
        </header>
        <main>{auth.status === 'loading' ? <p className="loading">Loading…</p> : renderRoute(route)}</main>
      </div>
    </SessionContext.Provider>
  );
}
