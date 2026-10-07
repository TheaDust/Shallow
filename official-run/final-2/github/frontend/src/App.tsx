import { useEffect } from "react";

import { replace, useHashLocation } from "./lib/hash-route";
import { parseRoute } from "./lib/routes";
import { SessionProvider, useSession } from "./lib/session";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { HomePage } from "./pages/HomePage";
import { NewOrganizationPage } from "./pages/NewOrganizationPage";
import { NewTeamPage } from "./pages/NewTeamPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OrganizationAuditLogPage } from "./pages/OrganizationAuditLogPage";
import { OrganizationPage } from "./pages/OrganizationPage";
import { PasswordSettingsPage } from "./pages/PasswordSettingsPage";
import { RepositoryAccessPage } from "./pages/RepositoryAccessPage";
import { RepositoryCodePage } from "./pages/RepositoryCodePage";
import { RepositoryCommitPage } from "./pages/RepositoryCommitPage";
import { RepositoryCommitsPage } from "./pages/RepositoryCommitsPage";
import { RepositoryFilePage } from "./pages/RepositoryFilePage";
import { RepositoryForkPage } from "./pages/RepositoryForkPage";
import { RepositoryIssuePage } from "./pages/RepositoryIssuePage";
import { RepositoryIssuesPage } from "./pages/RepositoryIssuesPage";
import { RepositoryNewIssuePage } from "./pages/RepositoryNewIssuePage";
import { RepositoryNewPullRequestPage } from "./pages/RepositoryNewPullRequestPage";
import { RepositoryPullRequestPage } from "./pages/RepositoryPullRequestPage";
import { RepositoryPullRequestsPage } from "./pages/RepositoryPullRequestsPage";
import { RepositoryNewReleasePage } from "./pages/RepositoryNewReleasePage";
import { RepositoryReleasePage } from "./pages/RepositoryReleasePage";
import { RepositoryReleasesPage } from "./pages/RepositoryReleasesPage";
import { NewRepositoryPage } from "./pages/NewRepositoryPage";
import { RepositoryBranchesPage } from "./pages/RepositoryBranchesPage";
import { RepositoryNewFilePage } from "./pages/RepositoryNewFilePage";
import { RepositoryPage } from "./pages/RepositoryPage";
import { RepositorySearchPage } from "./pages/RepositorySearchPage";
import { RepositorySettingsPage } from "./pages/RepositorySettingsPage";
import { SearchResultsPage } from "./pages/SearchResultsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SessionsSettingsPage } from "./pages/SessionsSettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { TeamPage } from "./pages/TeamPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { YourOrganizationsPage } from "./pages/YourOrganizationsPage";

function RoutedView() {
  const { path, search } = useHashLocation();
  const { status, user, revoked } = useSession();

  // A session cookie the server no longer accepts sends this browser back to
  // the account-access page instead of keeping the previous signed-in view.
  useEffect(() => {
    if (revoked) replace("/sign-in");
  }, [revoked]);

  if (status === "loading") {
    return (
      <main className="page" aria-busy="true">
        <p role="status">Loading application…</p>
      </main>
    );
  }

  if (revoked) return <SignInPage />;

  const route = parseRoute(path);
  switch (route.name) {
    case "home":
    case "workspace":
      return user ? <WorkspacePage /> : <HomePage />;
    case "sign-in":
      return <SignInPage />;
    case "sign-up":
      return <SignUpPage />;
    case "forgot-password":
      return <ForgotPasswordPage />;
    // Global repository search stays open to visitors; the server applies the
    // same read rule as the lists and the repository pages.
    case "search":
      return <SearchResultsPage query={search.get("q") ?? ""} />;
    // Account settings and organization creation are protected: an
    // unauthenticated visitor landing on them sees the signed-out home page
    // with its "Sign in" entry.
    case "settings":
      return user ? <SettingsPage /> : <HomePage />;
    case "password-settings":
      return user ? <PasswordSettingsPage /> : <HomePage />;
    case "session-settings":
      return user ? <SessionsSettingsPage /> : <HomePage />;
    case "your-organizations":
      return user ? <YourOrganizationsPage /> : <HomePage />;
    case "new-organization":
      return user ? <NewOrganizationPage /> : <HomePage />;
    case "new-team":
      return user ? <NewTeamPage organizationId={route.organizationId} /> : <HomePage />;
    case "team":
      return user ? (
        <TeamPage organizationId={route.organizationId} teamName={route.teamName} tab={route.tab} />
      ) : (
        <HomePage />
      );
    // Public organization pages and repository overviews stay reachable without
    // a session; the server decides what a visitor may read.
    case "organization":
      return <OrganizationPage organizationId={route.organizationId} tab={route.tab} />;
    // The audit log is an Owner-only organization page; the server refuses any
    // other caller, so the view is reachable but never readable by mistake.
    case "organization-audit-log":
      return (
        <OrganizationAuditLogPage
          organizationId={route.organizationId}
          action={search.get("action") ?? ""}
        />
      );
    case "new-repository":
      return user ? <NewRepositoryPage /> : <HomePage />;
    case "repository":
      return <RepositoryPage owner={route.owner} name={route.repositoryName} />;
    // Forking needs a signed-in identity on both ends: the readable source and
    // the target namespace the account may create in.
    case "repository-fork":
      return user ? (
        <RepositoryForkPage owner={route.owner} name={route.repositoryName} />
      ) : (
        <HomePage />
      );
    case "repository-code":
      return (
        <RepositoryCodePage
          owner={route.owner}
          name={route.repositoryName}
          path={route.path}
          branch={search.get("branch") ?? ""}
        />
      );
    case "repository-file":
      return (
        <RepositoryFilePage
          owner={route.owner}
          name={route.repositoryName}
          path={route.path}
          branch={search.get("branch") ?? ""}
        />
      );
    case "repository-new-file":
      return (
        <RepositoryNewFilePage
          owner={route.owner}
          name={route.repositoryName}
          branch={search.get("branch") ?? ""}
        />
      );
    case "repository-commits":
      return (
        <RepositoryCommitsPage
          owner={route.owner}
          name={route.repositoryName}
          path={search.get("path") ?? ""}
          branch={search.get("branch") ?? ""}
        />
      );
    // The commit detail compares the readable commit with its parent revision;
    // the repository-scoped code search reads the query from the address.
    case "repository-commit":
      return (
        <RepositoryCommitPage
          owner={route.owner}
          name={route.repositoryName}
          commitId={route.commitId}
        />
      );
    case "repository-search":
      return (
        <RepositorySearchPage
          owner={route.owner}
          name={route.repositoryName}
          query={search.get("q") ?? ""}
        />
      );
    case "repository-settings":
      return <RepositorySettingsPage owner={route.owner} name={route.repositoryName} />;
    case "repository-branches":
      return <RepositoryBranchesPage owner={route.owner} name={route.repositoryName} />;
    case "repository-access":
      return <RepositoryAccessPage owner={route.owner} name={route.repositoryName} />;
    // The Issues list and the issue detail stay readable without a session for a
    // public repository; the server applies the same read rule as the rest.
    case "repository-issues":
      return (
        <RepositoryIssuesPage
          owner={route.owner}
          name={route.repositoryName}
          state={search.get("state") ?? ""}
          query={search.get("q") ?? ""}
        />
      );
    case "repository-issue":
      return (
        <RepositoryIssuePage
          owner={route.owner}
          name={route.repositoryName}
          number={route.issueNumber}
        />
      );
    // Creating an issue needs a signed-in writer on both ends.
    case "repository-new-issue":
      return user ? (
        <RepositoryNewIssuePage owner={route.owner} name={route.repositoryName} />
      ) : (
        <HomePage />
      );
    // The Pull requests list and the comparison page stay readable like the
    // other repository views; the server applies the shared read rule and
    // decides whether the caller may create a proposal.
    case "repository-pulls":
      return (
        <RepositoryPullRequestsPage
          owner={route.owner}
          name={route.repositoryName}
          state={search.get("state") ?? ""}
        />
      );
    case "repository-pull-new":
      return <RepositoryNewPullRequestPage owner={route.owner} name={route.repositoryName} />;
    case "repository-pull":
      return (
        <RepositoryPullRequestPage
          owner={route.owner}
          name={route.repositoryName}
          number={route.pullNumber}
          tab="conversation"
        />
      );
    case "repository-pull-commits":
      return (
        <RepositoryPullRequestPage
          owner={route.owner}
          name={route.repositoryName}
          number={route.pullNumber}
          tab="commits"
        />
      );
    case "repository-pull-files":
      return (
        <RepositoryPullRequestPage
          owner={route.owner}
          name={route.repositoryName}
          number={route.pullNumber}
          tab="files"
        />
      );
    case "repository-pull-checks":
      return (
        <RepositoryPullRequestPage
          owner={route.owner}
          name={route.repositoryName}
          number={route.pullNumber}
          tab="checks"
        />
      );
    // The Releases list, the publishing form and one published release stay
    // readable like the other repository views; the server applies the shared
    // read rule and decides whether the caller may publish.
    case "repository-releases":
      return <RepositoryReleasesPage owner={route.owner} name={route.repositoryName} />;
    case "repository-release":
      return (
        <RepositoryReleasePage
          owner={route.owner}
          name={route.repositoryName}
          tag={route.tag}
        />
      );
    // Publishing a release needs a signed-in writer on both ends.
    case "repository-new-release":
      return user ? (
        <RepositoryNewReleasePage owner={route.owner} name={route.repositoryName} />
      ) : (
        <HomePage />
      );
    default:
      return <NotFoundPage />;
  }
}

export function App() {
  return (
    <SessionProvider>
      <RoutedView />
    </SessionProvider>
  );
}
