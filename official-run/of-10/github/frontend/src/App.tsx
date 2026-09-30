import { AuthProvider } from "./auth/AuthProvider";
import { AppHeader } from "./layout/AppHeader";
import { useHashLocation } from "./lib/hash-route";
import { matchOrganizationRoute, type OrganizationRoute } from "./lib/organization-routes";
import { matchRepositoryRoute, type RepositoryRoute } from "./lib/repository-routes";
import { HomePage } from "./pages/HomePage";
import { NewOrganizationPage } from "./pages/NewOrganizationPage";
import { NewRepositoryPage } from "./pages/NewRepositoryPage";
import { NewTeamPage } from "./pages/NewTeamPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OrganizationPage } from "./pages/OrganizationPage";
import { PasswordResetPage } from "./pages/PasswordResetPage";
import { PasswordSettingsPage } from "./pages/PasswordSettingsPage";
import { RepositoryAccessPage } from "./pages/RepositoryAccessPage";
import { RepositoryBranchesSettingsPage } from "./pages/RepositoryBranchesSettingsPage";
import { RepositoryCommitPage } from "./pages/RepositoryCommitPage";
import { RepositoryCommitsPage } from "./pages/RepositoryCommitsPage";
import { RepositoryComparePage } from "./pages/RepositoryComparePage";
import { RepositoryFileEditorPage } from "./pages/RepositoryFileEditorPage";
import { RepositoryFilePage } from "./pages/RepositoryFilePage";
import { RepositoryGeneralSettingsPage } from "./pages/RepositoryGeneralSettingsPage";
import { RepositoryIssuePage } from "./pages/RepositoryIssuePage";
import { RepositoryIssuesPage } from "./pages/RepositoryIssuesPage";
import { RepositoryNewIssuePage } from "./pages/RepositoryNewIssuePage";
import { RepositoryOverviewPage } from "./pages/RepositoryOverviewPage";
import { RepositoryPullRequestComparePage } from "./pages/RepositoryPullRequestComparePage";
import { RepositoryPullRequestPage } from "./pages/RepositoryPullRequestPage";
import { RepositoryPullRequestsPage } from "./pages/RepositoryPullRequestsPage";
import { RepositorySettingsPage } from "./pages/RepositorySettingsPage";
import { RepositoryTreePage } from "./pages/RepositoryTreePage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { TeamPage } from "./pages/TeamPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { YourOrganizationsPage } from "./pages/YourOrganizationsPage";

/**
 * Account-access routes and protected pages own their session UI (forms and the
 * "Sign in" link), so the header omits the shared guest entries there.
 */
const SELF_CONTAINED_AUTH_PATHS = new Set([
  "/signin",
  "/signup",
  "/password-reset",
  "/settings",
  "/settings/password",
  // The repository-creation form requires a session and renders its own entry.
  "/new",
]);

function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function organizationPage(route: OrganizationRoute) {
  switch (route.kind) {
    case "list":
      return <YourOrganizationsPage />;
    case "new":
      return <NewOrganizationPage />;
    case "tab":
      return <OrganizationPage login={route.login} tab={route.tab} />;
    case "new-team":
      return <NewTeamPage login={route.login} />;
    case "team":
      return <TeamPage login={route.login} team={route.team} tab="members" />;
    case "team-settings":
      return <TeamPage login={route.login} team={route.team} tab="settings" />;
    default:
      return <OrganizationPage login={route.login} tab="repositories" />;
  }
}

function repositoryPage(route: RepositoryRoute) {
  switch (route.kind) {
    case "pulls":
      return <RepositoryPullRequestsPage owner={route.owner} name={route.name} />;
    case "pull-new":
      return <RepositoryPullRequestComparePage owner={route.owner} name={route.name} />;
    case "pull":
      return (
        <RepositoryPullRequestPage
          owner={route.owner}
          name={route.name}
          number={route.number}
        />
      );
    case "issues":
      return <RepositoryIssuesPage owner={route.owner} name={route.name} />;
    case "issue-new":
      return <RepositoryNewIssuePage owner={route.owner} name={route.name} />;
    case "issue":
      return (
        <RepositoryIssuePage owner={route.owner} name={route.name} number={route.number} />
      );
    case "tree":
      return (
        <RepositoryTreePage
          owner={route.owner}
          name={route.name}
          branch={route.branch}
          path={route.path}
        />
      );
    case "blob":
      return (
        <RepositoryFilePage
          owner={route.owner}
          name={route.name}
          branch={route.branch}
          path={route.path}
        />
      );
    case "editor":
      return (
        <RepositoryFileEditorPage
          owner={route.owner}
          name={route.name}
          branch={route.branch}
          path={route.path}
        />
      );
    case "commits":
      return (
        <RepositoryCommitsPage
          owner={route.owner}
          name={route.name}
          branch={route.branch}
          path={route.path}
        />
      );
    case "commit":
      return (
        <RepositoryCommitPage owner={route.owner} name={route.name} commitId={route.commitId} />
      );
    case "compare":
      return <RepositoryComparePage owner={route.owner} name={route.name} />;
    case "settings":
      return <RepositorySettingsPage owner={route.owner} name={route.name} />;
    case "settings-general":
      return <RepositoryGeneralSettingsPage owner={route.owner} name={route.name} />;
    case "settings-access":
      return <RepositoryAccessPage owner={route.owner} name={route.name} />;
    case "settings-branches":
      return <RepositoryBranchesSettingsPage owner={route.owner} name={route.name} />;
    default:
      return <RepositoryOverviewPage owner={route.owner} name={route.name} />;
  }
}

function AppShell() {
  const location = useHashLocation();
  const path = normalizePath(location.path);

  let page;
  // Organization addresses (including the GitHub-style `#/<login>`) resolve
  // before the repository alias, which needs two segments of its own.
  const organizationRoute = matchOrganizationRoute(path);
  if (organizationRoute) {
    page = organizationPage(organizationRoute);
  } else switch (path) {
    case "/":
      page = <HomePage />;
      break;
    case "/signin":
      page = <SignInPage />;
      break;
    case "/signup":
      page = <SignUpPage />;
      break;
    case "/password-reset":
      page = <PasswordResetPage />;
      break;
    case "/settings":
      page = <SettingsPage />;
      break;
    case "/settings/password":
      page = <PasswordSettingsPage />;
      break;
    case "/workspace":
      page = <WorkspacePage />;
      break;
    case "/search":
      page = <SearchPage />;
      break;
    case "/new":
      page = <NewRepositoryPage />;
      break;
    default: {
      const repositoryRoute = matchRepositoryRoute(path);
      page = repositoryRoute ? repositoryPage(repositoryRoute) : <NotFoundPage />;
    }
  }

  return (
    <div className="app-shell">
      <AppHeader showGuestEntries={!SELF_CONTAINED_AUTH_PATHS.has(path)} />
      {page}
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
