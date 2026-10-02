import { AppHeader } from "./components/AppHeader";
import { useHashLocation } from "./lib/hash-route";
import { SessionProvider } from "./lib/session";
import { HomePage } from "./pages/HomePage";
import { NamespacePage } from "./pages/NamespacePage";
import { NewIssuePage } from "./pages/NewIssuePage";
import { NewOrganizationPage } from "./pages/NewOrganizationPage";
import { NewRepositoryPage } from "./pages/NewRepositoryPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OrganizationPage, isOrganizationTab } from "./pages/OrganizationPage";
import { OrganizationsPage } from "./pages/OrganizationsPage";
import { NewTeamPage } from "./pages/NewTeamPage";
import { TeamPage, isTeamTab } from "./pages/TeamPage";
import { PasswordSettingsPage } from "./pages/PasswordSettingsPage";
import { RecoveryPage } from "./pages/RecoveryPage";
import { RegisterPage } from "./pages/RegisterPage";
import { RepositoryAccessPage } from "./pages/RepositoryAccessPage";
import { RepositoryBranchesSettingsPage } from "./pages/RepositoryBranchesSettingsPage";
import { RepositoryCommitPage } from "./pages/RepositoryCommitPage";
import { RepositoryCommitsPage } from "./pages/RepositoryCommitsPage";
import { RepositoryComparePage } from "./pages/RepositoryComparePage";
import { RepositoryEditorPage } from "./pages/RepositoryEditorPage";
import { ForkRepositoryPage } from "./pages/ForkRepositoryPage";
import { RepositoryFilePage } from "./pages/RepositoryFilePage";
import { RepositoryGeneralSettingsPage } from "./pages/RepositoryGeneralSettingsPage";
import { RepositoryIssuesPage } from "./pages/RepositoryIssuesPage";
import { RepositoryIssuePage } from "./pages/RepositoryIssuePage";
import { RepositoryNewPullRequestPage } from "./pages/RepositoryNewPullRequestPage";
import { RepositoryPage } from "./pages/RepositoryPage";
import { RepositoryPullRequestPage } from "./pages/RepositoryPullRequestPage";
import { RepositoryPullRequestsPage } from "./pages/RepositoryPullRequestsPage";
import { RepositorySettingsPage } from "./pages/RepositorySettingsPage";
import { RepositoryTreePage } from "./pages/RepositoryTreePage";
import { SearchResultsPage } from "./pages/SearchResultsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { WorkspacePage } from "./pages/WorkspacePage";

const AUTH_ROUTES = ["/sign-in", "/register", "/forgot-password"];

function decodeSegments(path: string): string[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

/**
 * Organization destinations accept both the identifier-scoped form
 * (`#/organizations/acme-demo`, optionally with `repositories`, `people` or
 * `teams`) and the GitHub-style short forms (`#/orgs/acme-demo`,
 * `#/acme-demo/acme-docs`), so a repository or organization can be opened by
 * its stable address and survives a reload. `#/<name>` is a namespace address:
 * an organization keeps its organization overview and an individual account
 * shows its repositories. `#/<owner>/<repository>` is the repository overview,
 * with `code[/<branch>]`, `issues[/<number>]`, `pulls`, `new/<branch>`, `edit/<branch>/<path>`,
 * `blob/<branch>/<path>`, `tree/<branch>/<path>`, `commits[?branch=&path=]`,
 * `commit/<commitId>`, `compare[?base=&compare=]`, `pulls[/<number>][?tab=]` and
 * `settings[/general|/branches|/access]` below it (REQ-2-3, REQ-3, REQ-4, REQ-6).
 *
 * A branch name may contain `/` (REQ-4-3-3), so links percent-encode it and the
 * Code page joins the remaining address segments back into one branch name; a
 * hand-typed `code/feature/api-v2` therefore opens the same branch.
 */
function renderRoute(path: string) {
  if (path === "/") return <HomePage />;
  if (path === "/workspace") return <WorkspacePage />;
  if (path === "/new") return <NewRepositoryPage />;
  if (path === "/settings") return <SettingsPage />;
  if (path === "/settings/password") return <PasswordSettingsPage />;
  if (path === "/search") return <SearchResultsPage />;

  const segments = decodeSegments(path);
  if (segments[0] === "organizations") {
    if (segments.length === 1) return <OrganizationsPage />;
    if (segments.length === 2 && segments[1] === "new") return <NewOrganizationPage />;
    if (segments.length === 2) return <OrganizationPage name={segments[1]} tab="repositories" />;
    if (segments[2] === "teams" && segments.length > 3) {
      if (segments.length === 4 && segments[3] === "new") {
        return <NewTeamPage organization={segments[1]} />;
      }
      if (segments.length === 4) return <TeamPage organization={segments[1]} team={segments[3]} tab="members" />;
      if (segments.length === 5 && isTeamTab(segments[4])) {
        return <TeamPage organization={segments[1]} team={segments[3]} tab={segments[4]} />;
      }
      return <NotFoundPage />;
    }
    if (segments.length === 3 && isOrganizationTab(segments[2])) {
      return <OrganizationPage name={segments[1]} tab={segments[2]} />;
    }
    return <NotFoundPage />;
  }
  if (segments[0] === "orgs") {
    if (segments.length === 2) return <OrganizationPage name={segments[1]} tab="repositories" />;
    if (segments.length === 3 && isOrganizationTab(segments[2])) {
      return <OrganizationPage name={segments[1]} tab={segments[2]} />;
    }
    return <NotFoundPage />;
  }
  if (segments.length === 1) return <NamespacePage name={segments[0]} />;
  if (segments.length >= 3 && segments[2] === "settings") {
    if (segments.length === 3) return <RepositorySettingsPage owner={segments[0]} name={segments[1]} />;
    if (segments.length === 4 && segments[3] === "general") {
      return <RepositoryGeneralSettingsPage owner={segments[0]} name={segments[1]} />;
    }
    if (segments.length === 4 && segments[3] === "branches") {
      return <RepositoryBranchesSettingsPage owner={segments[0]} name={segments[1]} />;
    }
    if (segments.length === 4 && segments[3] === "access") {
      return <RepositoryAccessPage owner={segments[0]} name={segments[1]} />;
    }
    return <NotFoundPage />;
  }
  if (segments.length === 3 && segments[2] === "fork") {
    return <ForkRepositoryPage owner={segments[0]} name={segments[1]} />;
  }
  if (segments.length === 3 && segments[2] === "commits") {
    return <RepositoryCommitsPage owner={segments[0]} name={segments[1]} />;
  }
  if (segments.length === 4 && segments[2] === "commit") {
    return <RepositoryCommitPage owner={segments[0]} name={segments[1]} commitId={segments[3]} />;
  }
  if (segments.length === 3 && segments[2] === "compare") {
    return <RepositoryComparePage owner={segments[0]} name={segments[1]} />;
  }
  if (segments.length === 3 && segments[2] === "issues") {
    return <RepositoryIssuesPage owner={segments[0]} name={segments[1]} />;
  }
  // The creation form of the current repository (REQ-5-2-1).
  if (segments.length === 4 && segments[2] === "issues" && segments[3] === "new") {
    return <NewIssuePage owner={segments[0]} name={segments[1]} />;
  }
  // One issue is opened by its repository-scoped number (REQ-5-1-2).
  if (segments.length === 4 && segments[2] === "issues") {
    return <RepositoryIssuePage owner={segments[0]} name={segments[1]} number={segments[3]} />;
  }
  if (segments.length === 3 && segments[2] === "pulls") {
    return <RepositoryPullRequestsPage owner={segments[0]} name={segments[1]} />;
  }
  // The comparison page of a new pull request (REQ-6-2-2): it is opened by the
  // “New pull request” link and carries the two selected branches in the query.
  if (segments.length === 4 && segments[2] === "pulls" && segments[3] === "new") {
    return <RepositoryNewPullRequestPage owner={segments[0]} name={segments[1]} />;
  }
  // One pull request is opened by its repository-scoped number (REQ-6).
  if (segments.length === 4 && segments[2] === "pulls") {
    return <RepositoryPullRequestPage owner={segments[0]} name={segments[1]} number={segments[3]} />;
  }
  if (segments.length >= 3 && segments[2] === "code") {
    if (segments.length === 3) return <RepositoryPage owner={segments[0]} name={segments[1]} />;
    // A branch name may hold `/`: the rest of the address is one branch name.
    return <RepositoryPage owner={segments[0]} name={segments[1]} branch={segments.slice(3).join("/")} />;
  }
  if (segments.length >= 3 && segments[2] === "new") {
    if (segments.length === 4) {
      return <RepositoryEditorPage owner={segments[0]} name={segments[1]} branch={segments[3]} mode="create" />;
    }
    return <NotFoundPage />;
  }
  if (segments.length >= 4 && segments[2] === "edit") {
    return (
      <RepositoryEditorPage
        owner={segments[0]}
        name={segments[1]}
        branch={segments[3]}
        path={segments.slice(4).join("/")}
        mode="edit"
      />
    );
  }
  if (segments.length >= 4 && segments[2] === "blob") {
    const filePath = segments.slice(4).join("/");
    return (
      <RepositoryFilePage owner={segments[0]} name={segments[1]} branch={segments[3]} path={filePath} />
    );
  }
  if (segments.length >= 4 && segments[2] === "tree") {
    return (
      <RepositoryTreePage
        owner={segments[0]}
        name={segments[1]}
        branch={segments[3]}
        path={segments.slice(4).join("/")}
      />
    );
  }
  if (segments.length === 2) return <RepositoryPage owner={segments[0]} name={segments[1]} />;
  return <NotFoundPage />;
}

function PageRoutes() {
  const { path } = useHashLocation();

  if (AUTH_ROUTES.includes(path)) {
    if (path === "/sign-in") return <SignInPage />;
    if (path === "/register") return <RegisterPage />;
    return <RecoveryPage />;
  }

  return (
    <>
      <AppHeader />
      {renderRoute(path)}
    </>
  );
}

export function App() {
  return (
    <SessionProvider>
      <PageRoutes />
    </SessionProvider>
  );
}
