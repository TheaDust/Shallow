import { useHashLocation, type HashLocation } from "./lib/hash-route";
import { decodePathSegments } from "./lib/repository-code-api";
import { AccountAccessPage } from "./features/account/AccountAccessPage";
import { AccountMenu } from "./features/account/AccountMenu";
import { AccountSessionProvider, useAccountSession } from "./features/account/AccountSession";
import { HomePage } from "./features/home/HomePage";
import { NewOrganizationPage } from "./features/organizations/NewOrganizationPage";
import { NewTeamPage } from "./features/organizations/NewTeamPage";
import { OrganizationListPage } from "./features/organizations/OrganizationListPage";
import { OrganizationOverviewPage } from "./features/organizations/OrganizationOverviewPage";
import { TeamPage } from "./features/organizations/TeamPage";
import { RepositoryAccessPage } from "./features/repositories/RepositoryAccessPage";
import { RepositoryBlobPage } from "./features/repositories/RepositoryBlobPage";
import { RepositoryBranchesSettingsPage } from "./features/repositories/RepositoryBranchesSettingsPage";
import { RepositoryFileEditorPage } from "./features/repositories/RepositoryFileEditorPage";
import { RepositoryCodeSearchPage } from "./features/repositories/RepositoryCodeSearchPage";
import { RepositoryCommitPage } from "./features/repositories/RepositoryCommitPage";
import { RepositoryCommitsPage } from "./features/repositories/RepositoryCommitsPage";
import { RepositoryComparePage } from "./features/repositories/RepositoryComparePage";
import { NewRepositoryPage } from "./features/repositories/NewRepositoryPage";
import { RepositoryOverviewPage } from "./features/repositories/RepositoryOverviewPage";
import { RepositorySettingsPage } from "./features/repositories/RepositorySettingsPage";
import { RepositoryTreePage } from "./features/repositories/RepositoryTreePage";
import { GlobalSearchBox } from "./features/search/GlobalSearchBox";
import { SearchResultsPage } from "./features/search/SearchResultsPage";
import { IssueDetailPage } from "./features/issues/IssueDetailPage";
import { IssuesListPage } from "./features/issues/IssuesListPage";
import { NewIssuePage } from "./features/issues/NewIssuePage";
import { PullRequestDetailPage } from "./features/pulls/PullRequestDetailPage";
import { PullRequestsComparePage } from "./features/pulls/PullRequestsComparePage";
import { PullRequestsListPage } from "./features/pulls/PullRequestsListPage";
import { PasswordSettingsPage } from "./features/settings/PasswordSettingsPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { WorkspacePage } from "./features/workspace/WorkspacePage";

function NotFoundPage() {
  return (
    <>
      <h1>Page not found</h1>
      <p>
        <a href="#/">Go to the home page</a>
      </p>
    </>
  );
}

function decodePath(value: string): string {
  return decodePathSegments(value).join("/");
}

function routeView(location: HashLocation) {
  const { path, search } = location;
  switch (path) {
    case "/":
      return <HomePage />;
    case "/login":
      return <AccountAccessPage view="signin" />;
    case "/signup":
      return <AccountAccessPage view="register" />;
    case "/forgot-password":
      return <AccountAccessPage view="recover" />;
    case "/dashboard":
      return <WorkspacePage />;
    case "/repositories/new":
      return <NewRepositoryPage />;
    case "/settings":
      return <SettingsPage />;
    case "/settings/password":
      return <PasswordSettingsPage />;
    case "/organizations":
      return <OrganizationListPage />;
    case "/organizations/new":
      return <NewOrganizationPage />;
    case "/search":
      return (
        <SearchResultsPage
          query={search.get("q") ?? ""}
          type={search.get("type") ?? "repositories"}
        />
      );
  }

  const newTeamMatch = /^\/organizations\/([^/]+)\/teams\/new$/.exec(path);
  if (newTeamMatch) {
    return <NewTeamPage organizationName={decodeURIComponent(newTeamMatch[1])} />;
  }

  const teamMatch = /^\/organizations\/([^/]+)\/teams\/([^/]+)$/.exec(path);
  if (teamMatch) {
    return (
      <TeamPage
        organizationName={decodeURIComponent(teamMatch[1])}
        teamName={decodeURIComponent(teamMatch[2])}
        tab={search.get("tab") ?? "members"}
      />
    );
  }

  const organizationMatch = /^\/organizations\/([^/]+)$/.exec(path);
  if (organizationMatch) {
    return (
      <OrganizationOverviewPage
        organizationName={decodeURIComponent(organizationMatch[1])}
        tab={search.get("tab") ?? "repositories"}
      />
    );
  }

  const repositoryAccessMatch = /^\/repositories\/([^/]+)\/([^/]+)\/settings\/access$/.exec(path);
  if (repositoryAccessMatch) {
    return (
      <RepositoryAccessPage
        owner={decodeURIComponent(repositoryAccessMatch[1])}
        name={decodeURIComponent(repositoryAccessMatch[2])}
      />
    );
  }

  const repositoryBranchesSettingsMatch = /^\/repositories\/([^/]+)\/([^/]+)\/settings\/branches$/.exec(
    path,
  );
  if (repositoryBranchesSettingsMatch) {
    return (
      <RepositoryBranchesSettingsPage
        owner={decodeURIComponent(repositoryBranchesSettingsMatch[1])}
        name={decodeURIComponent(repositoryBranchesSettingsMatch[2])}
      />
    );
  }

  const repositoryEditorMatch = /^\/repositories\/([^/]+)\/([^/]+)\/edit\/([^/]+)(?:\/(.*))?$/.exec(
    path,
  );
  if (repositoryEditorMatch) {
    return (
      <RepositoryFileEditorPage
        owner={decodeURIComponent(repositoryEditorMatch[1])}
        name={decodeURIComponent(repositoryEditorMatch[2])}
        branch={decodeURIComponent(repositoryEditorMatch[3])}
        path={decodePath(repositoryEditorMatch[4] ?? "")}
      />
    );
  }

  const repositoryBlobMatch = /^\/repositories\/([^/]+)\/([^/]+)\/blob\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (repositoryBlobMatch) {
    const rawLine = search.get("line");
    const line = rawLine === null ? undefined : Number.parseInt(rawLine, 10);
    return (
      <RepositoryBlobPage
        owner={decodeURIComponent(repositoryBlobMatch[1])}
        name={decodeURIComponent(repositoryBlobMatch[2])}
        branch={decodeURIComponent(repositoryBlobMatch[3])}
        path={decodePath(repositoryBlobMatch[4] ?? "")}
        line={line !== undefined && Number.isFinite(line) ? line : undefined}
      />
    );
  }

  const repositoryCommitMatch = /^\/repositories\/([^/]+)\/([^/]+)\/commit\/([^/]+)$/.exec(path);
  if (repositoryCommitMatch) {
    return (
      <RepositoryCommitPage
        owner={decodeURIComponent(repositoryCommitMatch[1])}
        name={decodeURIComponent(repositoryCommitMatch[2])}
        revision={decodeURIComponent(repositoryCommitMatch[3])}
        path={search.get("path") ?? ""}
      />
    );
  }

  const repositoryCommitsMatch = /^\/repositories\/([^/]+)\/([^/]+)\/commits$/.exec(path);
  if (repositoryCommitsMatch) {
    return (
      <RepositoryCommitsPage
        owner={decodeURIComponent(repositoryCommitsMatch[1])}
        name={decodeURIComponent(repositoryCommitsMatch[2])}
        branch={search.get("branch") ?? ""}
        path={search.get("path") ?? ""}
      />
    );
  }

  const repositoryCompareMatch = /^\/repositories\/([^/]+)\/([^/]+)\/compare$/.exec(path);
  if (repositoryCompareMatch) {
    return (
      <RepositoryComparePage
        owner={decodeURIComponent(repositoryCompareMatch[1])}
        name={decodeURIComponent(repositoryCompareMatch[2])}
        branch={search.get("branch") ?? ""}
        base={search.get("base") ?? ""}
        compare={search.get("compare") ?? ""}
        path={search.get("path") ?? ""}
      />
    );
  }

  const repositoryCodeSearchMatch = /^\/repositories\/([^/]+)\/([^/]+)\/search$/.exec(path);
  if (repositoryCodeSearchMatch) {
    return (
      <RepositoryCodeSearchPage
        owner={decodeURIComponent(repositoryCodeSearchMatch[1])}
        name={decodeURIComponent(repositoryCodeSearchMatch[2])}
        query={search.get("q") ?? ""}
        path={search.get("path") ?? ""}
        language={search.get("language") ?? ""}
      />
    );
  }

  const repositoryNewPullMatch = /^\/repositories\/([^/]+)\/([^/]+)\/pulls\/(?:new|compare)$/.exec(path);
  if (repositoryNewPullMatch) {
    return (
      <PullRequestsComparePage
        owner={decodeURIComponent(repositoryNewPullMatch[1])}
        name={decodeURIComponent(repositoryNewPullMatch[2])}
        base={search.get("base") ?? ""}
        compare={search.get("compare") ?? ""}
      />
    );
  }

  const repositoryPullMatch = /^\/repositories\/([^/]+)\/([^/]+)\/pulls\/(\d+)(?:\/(commits|files|checks))?$/.exec(
    path,
  );
  if (repositoryPullMatch) {
    const section = repositoryPullMatch[4];
    return (
      <PullRequestDetailPage
        owner={decodeURIComponent(repositoryPullMatch[1])}
        name={decodeURIComponent(repositoryPullMatch[2])}
        number={decodeURIComponent(repositoryPullMatch[3])}
        section={
          section === "commits" || section === "files" || section === "checks"
            ? section
            : "conversation"
        }
      />
    );
  }

  const repositoryPullsMatch = /^\/repositories\/([^/]+)\/([^/]+)\/pulls$/.exec(path);
  if (repositoryPullsMatch) {
    return (
      <PullRequestsListPage
        owner={decodeURIComponent(repositoryPullsMatch[1])}
        name={decodeURIComponent(repositoryPullsMatch[2])}
        state={search.get("state") ?? ""}
        author={search.get("author") ?? ""}
        review={search.get("review") ?? ""}
      />
    );
  }

  const repositoryNewIssueMatch = /^\/repositories\/([^/]+)\/([^/]+)\/issues\/new$/.exec(path);
  if (repositoryNewIssueMatch) {
    return (
      <NewIssuePage
        owner={decodeURIComponent(repositoryNewIssueMatch[1])}
        name={decodeURIComponent(repositoryNewIssueMatch[2])}
      />
    );
  }

  const repositoryIssueMatch = /^\/repositories\/([^/]+)\/([^/]+)\/issues\/([^/]+)$/.exec(path);
  if (repositoryIssueMatch) {
    return (
      <IssueDetailPage
        owner={decodeURIComponent(repositoryIssueMatch[1])}
        name={decodeURIComponent(repositoryIssueMatch[2])}
        number={decodeURIComponent(repositoryIssueMatch[3])}
      />
    );
  }

  const repositoryIssuesMatch = /^\/repositories\/([^/]+)\/([^/]+)\/issues$/.exec(path);
  if (repositoryIssuesMatch) {
    return (
      <IssuesListPage
        owner={decodeURIComponent(repositoryIssuesMatch[1])}
        name={decodeURIComponent(repositoryIssuesMatch[2])}
        state={search.get("state") ?? ""}
        query={search.get("q") ?? ""}
        labels={search.get("labels") ?? ""}
      />
    );
  }

  const repositoryTreeMatch = /^\/repositories\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (repositoryTreeMatch) {
    return (
      <RepositoryTreePage
        owner={decodeURIComponent(repositoryTreeMatch[1])}
        name={decodeURIComponent(repositoryTreeMatch[2])}
        branch={decodeURIComponent(repositoryTreeMatch[3])}
        path={decodePath(repositoryTreeMatch[4] ?? "")}
      />
    );
  }

  const repositorySettingsMatch = /^\/repositories\/([^/]+)\/([^/]+)\/settings(?:\/([^/]+))?$/.exec(path);
  if (repositorySettingsMatch) {
    const settingsSection = repositorySettingsMatch[3];
    if (settingsSection === undefined || settingsSection === "general") {
      return (
        <RepositorySettingsPage
          owner={decodeURIComponent(repositorySettingsMatch[1])}
          name={decodeURIComponent(repositorySettingsMatch[2])}
        />
      );
    }
  }

  const repositoryMatch = /^\/repositories\/([^/]+)\/([^/]+)$/.exec(path);
  if (repositoryMatch) {
    return (
      <RepositoryOverviewPage
        owner={decodeURIComponent(repositoryMatch[1])}
        name={decodeURIComponent(repositoryMatch[2])}
      />
    );
  }

  return <NotFoundPage />;
}

function AppShell() {
  const location = useHashLocation();
  const { account } = useAccountSession();

  return (
    <div className="app">
      <header className="app-header">
        <a className="app-header__brand" href="#/">
          GitHub
        </a>
        <GlobalSearchBox />
        <div className="app-header__account">
          {account ? <AccountMenu username={account.username} /> : null}
        </div>
      </header>
      <main>{routeView(location)}</main>
    </div>
  );
}

export function App() {
  return (
    <AccountSessionProvider>
      <AppShell />
    </AccountSessionProvider>
  );
}
