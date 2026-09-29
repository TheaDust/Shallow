import { useEffect, useState, type FormEvent } from "react";

import { useHashLocation, navigate } from "./lib/hash-route";
import { AccountAccessPage } from "./features/auth/AccountAccessPage";
import { AccountMenu } from "./features/auth/AccountMenu";
import { SessionProvider, useSession } from "./features/auth/session";
import { ManageAccessPage } from "./features/organizations/ManageAccessPage";
import { NewOrganizationPage } from "./features/organizations/NewOrganizationPage";
import { NewRepositoryPage } from "./features/organizations/NewRepositoryPage";
import { NewTeamPage } from "./features/organizations/NewTeamPage";
import { OrganizationPage, type OrganizationTab } from "./features/organizations/OrganizationPage";
import { OrganizationsPage } from "./features/organizations/OrganizationsPage";
import { RepositoryPage } from "./features/organizations/RepositoryPage";
import { RepositorySettingsPage } from "./features/organizations/RepositorySettingsPage";
import { BranchesPage } from "./features/organizations/BranchesPage";
import { TeamPage, type TeamTab } from "./features/organizations/TeamPage";
import { CodePage } from "./features/organizations/CodePage";
import { BlobPage } from "./features/organizations/BlobPage";
import { CommitHistoryPage } from "./features/organizations/CommitHistoryPage";
import { CommitDetailPage } from "./features/organizations/CommitDetailPage";
import { ComparePage } from "./features/organizations/ComparePage";
import { RepoCodeSearchPage } from "./features/organizations/RepoCodeSearchPage";
import { FileEditorPage } from "./features/organizations/FileEditorPage";
import { IssuesPage } from "./features/issues/IssuesPage";
import { IssueDetailPage } from "./features/issues/IssueDetailPage";
import { NewIssuePage } from "./features/issues/NewIssuePage";
import { PullRequestsPage } from "./features/pulls/PullRequestsPage";
import { PullRequestNewPage } from "./features/pulls/PullRequestNewPage";
import { PullRequestDetailPage } from "./features/pulls/PullRequestDetailPage";
import { SearchResultsPage } from "./features/search/SearchResultsPage";
import { HomePage } from "./pages/HomePage";
import { PasswordAndAuthenticationPage } from "./pages/PasswordAndAuthenticationPage";
import { SettingsPage } from "./pages/SettingsPage";

function matchPath(path: string, pattern: string): Record<string, string> | null {
  const parts = pattern.split("/").filter(Boolean);
  const segments = path.split("/").filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].startsWith(":")) {
      try {
        params[parts[index].slice(1)] = decodeURIComponent(segments[index]);
      } catch {
        return null;
      }
    } else if (parts[index] !== segments[index]) {
      return null;
    }
  }
  return params;
}

function TopBar() {
  const { session } = useSession();
  const location = useHashLocation();
  const routeQuery = location.path === "/search" ? (location.search.get("q") ?? "") : "";
  const [query, setQuery] = useState(routeQuery);

  useEffect(() => {
    if (location.path === "/search") setQuery(routeQuery);
  }, [location.path, routeQuery]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = query.trim();
    navigate("/search", q ? new URLSearchParams({ q }) : new URLSearchParams());
  };

  return (
    <header className="app-topbar">
      <a href="#/" className="app-topbar__home">
        Home
      </a>
      <form role="search" className="app-topbar__search" onSubmit={submit}>
        <input
          type="search"
          aria-label="Search"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      <div className="app-topbar__actions">
        {session.status === "authenticated" ? <AccountMenu account={session.account} /> : null}
      </div>
    </header>
  );
}

function Shell() {
  const location = useHashLocation();
  const route = location.path;
  const { session } = useSession();
  const authenticated = session.status === "authenticated";

  let page;
  if (route === "/signin") page = <AccountAccessPage mode="signin" />;
  else if (route === "/signup") page = <AccountAccessPage mode="signup" />;
  else if (route === "/forgot-password") page = <AccountAccessPage mode="forgot-password" />;
  else if (route === "/search") page = <SearchResultsPage />;
  else if (route === "/settings") {
    page = authenticated ? <SettingsPage /> : <HomePage />;
  } else if (route === "/settings/password-and-authentication") {
    page = authenticated ? <PasswordAndAuthenticationPage /> : <HomePage />;
  } else if (route === "/organizations") {
    page = authenticated ? <OrganizationsPage /> : <HomePage />;
  } else if (route === "/organizations/new") {
    page = authenticated ? <NewOrganizationPage /> : <HomePage />;
  } else if (route === "/repositories/new") {
    page = authenticated ? <NewRepositoryPage /> : <HomePage />;
  } else {
    const teamsNew = matchPath(route, "/orgs/:org/teams/new");
    const teamMembers = matchPath(route, "/orgs/:org/teams/:team/members");
    const teamSettings = matchPath(route, "/orgs/:org/teams/:team/settings");
    const team = matchPath(route, "/orgs/:org/teams/:team");
    const orgRepositories = matchPath(route, "/orgs/:org/repositories");
    const orgPeople = matchPath(route, "/orgs/:org/people");
    const orgTeams = matchPath(route, "/orgs/:org/teams");
    const org = matchPath(route, "/orgs/:org");
    const repoAccess = matchPath(route, "/repos/:owner/:name/settings/access");
    const repoSettings = matchPath(route, "/repos/:owner/:name/settings");
    const repoBranches = matchPath(route, "/repos/:owner/:name/settings/branches");
    const repoCommits = matchPath(route, "/repos/:owner/:name/commits");
    const repoCommit = matchPath(route, "/repos/:owner/:name/commit/:commitId");
    const repoCompare = matchPath(route, "/repos/:owner/:name/compare");
    const repoSearch = matchPath(route, "/repos/:owner/:name/search");
    const repoNewFile = matchPath(route, "/repos/:owner/:name/new");
    const repoEditFile = matchPath(route, "/repos/:owner/:name/edit");
    const repoTree = matchPath(route, "/repos/:owner/:name/tree");
    const repoBlob = matchPath(route, "/repos/:owner/:name/blob");
    const repoIssues = matchPath(route, "/repos/:owner/:name/issues");
    const repoPulls = matchPath(route, "/repos/:owner/:name/pulls");
    const repoNewPull = matchPath(route, "/repos/:owner/:name/pulls/new");
    const repoPull = matchPath(route, "/repos/:owner/:name/pulls/:number");
    const repoNewIssue = matchPath(route, "/repos/:owner/:name/issues/new");
    const repoIssue = matchPath(route, "/repos/:owner/:name/issues/:number");
    const repo = matchPath(route, "/repos/:owner/:name");

    if (teamsNew) page = <NewTeamPage orgId={teamsNew.org} />;
    else if (teamMembers) page = <TeamPage orgId={teamMembers.org} teamName={teamMembers.team} tab="members" />;
    else if (teamSettings) page = <TeamPage orgId={teamSettings.org} teamName={teamSettings.team} tab="settings" />;
    else if (team) page = <TeamPage orgId={team.org} teamName={team.team} tab="members" />;
    else if (orgRepositories) page = <OrganizationPage orgId={orgRepositories.org} tab="repositories" />;
    else if (orgPeople) page = <OrganizationPage orgId={orgPeople.org} tab="people" />;
    else if (orgTeams) page = <OrganizationPage orgId={orgTeams.org} tab="teams" />;
    else if (org) page = <OrganizationPage orgId={org.org} tab="repositories" />;
    else if (repoAccess) page = <ManageAccessPage owner={repoAccess.owner} name={repoAccess.name} />;
    else if (repoBranches) page = <BranchesPage owner={repoBranches.owner} name={repoBranches.name} />;
    else if (repoSettings) page = <RepositorySettingsPage owner={repoSettings.owner} name={repoSettings.name} />;
    else if (repoCommits) page = <CommitHistoryPage owner={repoCommits.owner} name={repoCommits.name} />;
    else if (repoCommit) page = <CommitDetailPage owner={repoCommit.owner} name={repoCommit.name} commitId={repoCommit.commitId} />;
    else if (repoCompare) page = <ComparePage owner={repoCompare.owner} name={repoCompare.name} />;
    else if (repoSearch) page = <RepoCodeSearchPage owner={repoSearch.owner} name={repoSearch.name} />;
    else if (repoNewFile) page = <FileEditorPage owner={repoNewFile.owner} name={repoNewFile.name} mode="new" />;
    else if (repoEditFile) page = <FileEditorPage owner={repoEditFile.owner} name={repoEditFile.name} mode="edit" />;
    else if (repoTree) page = <CodePage owner={repoTree.owner} name={repoTree.name} />;
    else if (repoBlob) page = <BlobPage owner={repoBlob.owner} name={repoBlob.name} />;
    else if (repoNewIssue) page = <NewIssuePage owner={repoNewIssue.owner} name={repoNewIssue.name} />;
    else if (repoIssue) page = <IssueDetailPage owner={repoIssue.owner} name={repoIssue.name} number={repoIssue.number} />;
    else if (repoIssues) page = <IssuesPage owner={repoIssues.owner} name={repoIssues.name} />;
    else if (repoNewPull) page = <PullRequestNewPage owner={repoNewPull.owner} name={repoNewPull.name} />;
    else if (repoPull) page = <PullRequestDetailPage owner={repoPull.owner} name={repoPull.name} number={repoPull.number} />;
    else if (repoPulls) page = <PullRequestsPage owner={repoPulls.owner} name={repoPulls.name} />;
    else if (repo) page = <RepositoryPage owner={repo.owner} name={repo.name} />;
    else page = <HomePage />;
  }

  return (
    <div className="app-shell">
      <TopBar />
      <main>{page}</main>
    </div>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
