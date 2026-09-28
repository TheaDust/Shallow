import { useHashLocation } from "./lib/hash-route";
import { AccountAccessPage } from "./pages/AccountAccessPage";
import type { AccessMode } from "./pages/AccountAccessPage";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { ForkPage } from "./pages/repos/ForkPage";
import { NewRepositoryPage } from "./pages/repos/NewRepositoryPage";
import { RepoFileView } from "./pages/repos/RepoFileView";
import { RepoSettingsView } from "./pages/repos/RepoSettingsView";
import { RepoBranchesSettings } from "./pages/repos/RepoBranchesSettings";
import { RepositoryView } from "./pages/repos/RepositoryView";
import { UserRepositoriesPage } from "./pages/repos/UserRepositoriesPage";
import { CommitHistoryPage } from "./pages/repos/CommitHistoryPage";
import { CommitDetailPage } from "./pages/repos/CommitDetailPage";
import { ComparePage } from "./pages/repos/ComparePage";
import { FileEditorPage } from "./pages/repos/FileEditorPage";
import { SearchPage } from "./pages/search/SearchPage";
import { CodeSearchPage } from "./pages/search/CodeSearchPage";
import { IssuesPage } from "./pages/issues/IssuesPage";
import { IssueDetailPage } from "./pages/issues/IssueDetailPage";
import { NewIssuePage } from "./pages/issues/NewIssuePage";
import { PullRequestsPage } from "./pages/pulls/PullRequestsPage";
import { NewPullRequestPage } from "./pages/pulls/NewPullRequestPage";
import { PullRequestDetailPage } from "./pages/pulls/PullRequestDetailPage";
import { NewOrganizationPage } from "./pages/orgs/NewOrganizationPage";
import { ManageAccessPage } from "./pages/orgs/ManageAccessPage";
import { OrganizationPage } from "./pages/orgs/OrganizationPage";
import type { OrgTab } from "./pages/orgs/OrganizationPage";
import { OrganizationsPage } from "./pages/orgs/OrganizationsPage";
import { NewTeamPage } from "./pages/orgs/NewTeamPage";
import { TeamPage } from "./pages/orgs/TeamPage";
import type { TeamTab } from "./pages/orgs/TeamPage";
import { SessionProvider } from "./session";

export function App() {
  return (
    <SessionProvider>
      <Router />
    </SessionProvider>
  );
}

function Router() {
  const location = useHashLocation();
  const { path } = location;

  if (path === "/signin") return <AccountAccessPage mode="signin" />;
  if (path === "/signup") return <AccountAccessPage mode="signup" />;
  if (path === "/recover" || path === "/forgot-password") return <AccountAccessPage mode="recover" />;
  if (path === "/settings") return <SettingsPage />;
  if (path === "/orgs") return <OrganizationsPage />;
  if (path === "/orgs/new") return <NewOrganizationPage />;
  if (path === "/repos/new") return <NewRepositoryPage />;
  if (path === "/search") return <SearchPage />;

  const mode = accessModeFromPath(path);
  if (mode) return <AccountAccessPage mode={mode} />;

  const orgMatch = path.match(/^\/o\/([^/]+)$/);
  if (orgMatch) return <OrganizationPage orgName={decodeURIComponent(orgMatch[1])} tab="repositories" />;

  const peopleMatch = path.match(/^\/o\/([^/]+)\/people$/);
  if (peopleMatch) return <OrganizationPage orgName={decodeURIComponent(peopleMatch[1])} tab="people" />;

  const teamsMatch = path.match(/^\/o\/([^/]+)\/teams$/);
  if (teamsMatch) return <OrganizationPage orgName={decodeURIComponent(teamsMatch[1])} tab="teams" />;

  const newTeamMatch = path.match(/^\/o\/([^/]+)\/teams\/new$/);
  if (newTeamMatch) return <NewTeamPage orgName={decodeURIComponent(newTeamMatch[1])} />;

  const teamSettingsMatch = path.match(/^\/o\/([^/]+)\/teams\/([^/]+)\/settings$/);
  if (teamSettingsMatch) {
    return (
      <TeamPage
        orgName={decodeURIComponent(teamSettingsMatch[1])}
        teamName={decodeURIComponent(teamSettingsMatch[2])}
        tab="settings"
      />
    );
  }

  const teamMembersMatch = path.match(/^\/o\/([^/]+)\/teams\/([^/]+)\/members$/);
  if (teamMembersMatch) {
    return (
      <TeamPage
        orgName={decodeURIComponent(teamMembersMatch[1])}
        teamName={decodeURIComponent(teamMembersMatch[2])}
        tab="members"
      />
    );
  }

  const teamMatch = path.match(/^\/o\/([^/]+)\/teams\/([^/]+)$/);
  if (teamMatch) {
    return (
      <TeamPage
        orgName={decodeURIComponent(teamMatch[1])}
        teamName={decodeURIComponent(teamMatch[2])}
        tab="members"
      />
    );
  }

  const repoAccessMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/settings\/access$/);
  if (repoAccessMatch) {
    return (
      <ManageAccessPage
        orgName={decodeURIComponent(repoAccessMatch[1])}
        repoName={decodeURIComponent(repoAccessMatch[2])}
      />
    );
  }

  const orgRepoBranchesMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/settings\/branches$/);
  if (orgRepoBranchesMatch) {
    return (
      <RepoBranchesSettings
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoBranchesMatch[1])}
        repoName={decodeURIComponent(orgRepoBranchesMatch[2])}
        showManageAccess
      />
    );
  }

  const orgRepoSettingsMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/settings$/);
  if (orgRepoSettingsMatch) {
    return (
      <RepoSettingsView
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoSettingsMatch[1])}
        repoName={decodeURIComponent(orgRepoSettingsMatch[2])}
        showManageAccess
      />
    );
  }

  const orgRepoFileMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/files\/(.+)$/);
  if (orgRepoFileMatch) {
    return (
      <RepoFileView
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoFileMatch[1])}
        repoName={decodeURIComponent(orgRepoFileMatch[2])}
        filePath={decodeURIComponent(orgRepoFileMatch[3])}
        branch={location.search.get("branch") ?? undefined}
      />
    );
  }

  const orgRepoNewMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/new$/);
  if (orgRepoNewMatch) {
    return (
      <FileEditorPage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoNewMatch[1])}
        repoName={decodeURIComponent(orgRepoNewMatch[2])}
        mode="new"
        branch={location.search.get("branch") ?? undefined}
      />
    );
  }

  const orgRepoEditMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/edit$/);
  if (orgRepoEditMatch) {
    return (
      <FileEditorPage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoEditMatch[1])}
        repoName={decodeURIComponent(orgRepoEditMatch[2])}
        mode="edit"
        branch={location.search.get("branch") ?? undefined}
        path={location.search.get("path") ?? undefined}
      />
    );
  }

  const orgRepoCommitsMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/commits$/);
  if (orgRepoCommitsMatch) {
    return (
      <CommitHistoryPage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoCommitsMatch[1])}
        repoName={decodeURIComponent(orgRepoCommitsMatch[2])}
        branch={location.search.get("branch") ?? undefined}
        path={location.search.get("path") ?? undefined}
      />
    );
  }

  const orgRepoCommitMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/commit\/([^/]+)$/);
  if (orgRepoCommitMatch) {
    return (
      <CommitDetailPage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoCommitMatch[1])}
        repoName={decodeURIComponent(orgRepoCommitMatch[2])}
        commitId={decodeURIComponent(orgRepoCommitMatch[3])}
      />
    );
  }

  const orgRepoCompareMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/compare$/);
  if (orgRepoCompareMatch) {
    return (
      <ComparePage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoCompareMatch[1])}
        repoName={decodeURIComponent(orgRepoCompareMatch[2])}
        base={location.search.get("base") ?? undefined}
        compare={location.search.get("compare") ?? undefined}
        path={location.search.get("path") ?? undefined}
      />
    );
  }

  const orgRepoForkMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/fork$/);
  if (orgRepoForkMatch) {
    return (
      <ForkPage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoForkMatch[1])}
        repoName={decodeURIComponent(orgRepoForkMatch[2])}
      />
    );
  }

  const orgRepoNewIssueMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/issues\/new$/);
  if (orgRepoNewIssueMatch) {
    return (
      <NewIssuePage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoNewIssueMatch[1])}
        repoName={decodeURIComponent(orgRepoNewIssueMatch[2])}
      />
    );
  }

  const orgRepoIssueMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)$/);
  if (orgRepoIssueMatch) {
    return (
      <IssueDetailPage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoIssueMatch[1])}
        repoName={decodeURIComponent(orgRepoIssueMatch[2])}
        number={Number(orgRepoIssueMatch[3])}
      />
    );
  }

  const orgRepoIssuesMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/issues$/);
  if (orgRepoIssuesMatch) {
    return (
      <IssuesPage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoIssuesMatch[1])}
        repoName={decodeURIComponent(orgRepoIssuesMatch[2])}
      />
    );
  }

  const orgRepoPullsNewMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/pulls\/new$/);
  if (orgRepoPullsNewMatch) {
    return (
      <NewPullRequestPage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoPullsNewMatch[1])}
        repoName={decodeURIComponent(orgRepoPullsNewMatch[2])}
        base={location.search.get("base") ?? undefined}
        compare={location.search.get("compare") ?? undefined}
      />
    );
  }

  const orgRepoPullMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/pulls\/(\d+)$/);
  if (orgRepoPullMatch) {
    return (
      <PullRequestDetailPage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoPullMatch[1])}
        repoName={decodeURIComponent(orgRepoPullMatch[2])}
        number={Number(orgRepoPullMatch[3])}
      />
    );
  }

  const orgRepoPullsMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/pulls$/);
  if (orgRepoPullsMatch) {
    return (
      <PullRequestsPage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoPullsMatch[1])}
        repoName={decodeURIComponent(orgRepoPullsMatch[2])}
      />
    );
  }

  const orgRepoSearchMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)\/search$/);
  if (orgRepoSearchMatch) {
    return (
      <CodeSearchPage
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoSearchMatch[1])}
        repoName={decodeURIComponent(orgRepoSearchMatch[2])}
        branch={location.search.get("branch") ?? undefined}
      />
    );
  }

  const orgRepoMatch = path.match(/^\/o\/([^/]+)\/repos\/([^/]+)$/);
  if (orgRepoMatch) {
    return (
      <RepositoryView
        ownerType="organization"
        ownerName={decodeURIComponent(orgRepoMatch[1])}
        repoName={decodeURIComponent(orgRepoMatch[2])}
        section="code"
        branch={location.search.get("branch") ?? undefined}
        path={location.search.get("path") ?? undefined}
      />
    );
  }

  const userMatch = path.match(/^\/u\/([^/]+)$/);
  if (userMatch) {
    return <UserRepositoriesPage username={decodeURIComponent(userMatch[1])} />;
  }

  const userRepoBranchesMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/settings\/branches$/);
  if (userRepoBranchesMatch) {
    return (
      <RepoBranchesSettings
        ownerType="account"
        ownerName={decodeURIComponent(userRepoBranchesMatch[1])}
        repoName={decodeURIComponent(userRepoBranchesMatch[2])}
        showManageAccess={false}
      />
    );
  }

  const userRepoSettingsMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/settings$/);
  if (userRepoSettingsMatch) {
    return (
      <RepoSettingsView
        ownerType="account"
        ownerName={decodeURIComponent(userRepoSettingsMatch[1])}
        repoName={decodeURIComponent(userRepoSettingsMatch[2])}
        showManageAccess={false}
      />
    );
  }

  const userRepoFileMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/files\/(.+)$/);
  if (userRepoFileMatch) {
    return (
      <RepoFileView
        ownerType="account"
        ownerName={decodeURIComponent(userRepoFileMatch[1])}
        repoName={decodeURIComponent(userRepoFileMatch[2])}
        filePath={decodeURIComponent(userRepoFileMatch[3])}
        branch={location.search.get("branch") ?? undefined}
      />
    );
  }

  const userRepoNewMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/new$/);
  if (userRepoNewMatch) {
    return (
      <FileEditorPage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoNewMatch[1])}
        repoName={decodeURIComponent(userRepoNewMatch[2])}
        mode="new"
        branch={location.search.get("branch") ?? undefined}
      />
    );
  }

  const userRepoEditMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/edit$/);
  if (userRepoEditMatch) {
    return (
      <FileEditorPage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoEditMatch[1])}
        repoName={decodeURIComponent(userRepoEditMatch[2])}
        mode="edit"
        branch={location.search.get("branch") ?? undefined}
        path={location.search.get("path") ?? undefined}
      />
    );
  }

  const userRepoCommitsMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/commits$/);
  if (userRepoCommitsMatch) {
    return (
      <CommitHistoryPage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoCommitsMatch[1])}
        repoName={decodeURIComponent(userRepoCommitsMatch[2])}
        branch={location.search.get("branch") ?? undefined}
        path={location.search.get("path") ?? undefined}
      />
    );
  }

  const userRepoCommitMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/commit\/([^/]+)$/);
  if (userRepoCommitMatch) {
    return (
      <CommitDetailPage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoCommitMatch[1])}
        repoName={decodeURIComponent(userRepoCommitMatch[2])}
        commitId={decodeURIComponent(userRepoCommitMatch[3])}
      />
    );
  }

  const userRepoCompareMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/compare$/);
  if (userRepoCompareMatch) {
    return (
      <ComparePage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoCompareMatch[1])}
        repoName={decodeURIComponent(userRepoCompareMatch[2])}
        base={location.search.get("base") ?? undefined}
        compare={location.search.get("compare") ?? undefined}
        path={location.search.get("path") ?? undefined}
      />
    );
  }

  const userRepoForkMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/fork$/);
  if (userRepoForkMatch) {
    return (
      <ForkPage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoForkMatch[1])}
        repoName={decodeURIComponent(userRepoForkMatch[2])}
      />
    );
  }

  const userRepoNewIssueMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/issues\/new$/);
  if (userRepoNewIssueMatch) {
    return (
      <NewIssuePage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoNewIssueMatch[1])}
        repoName={decodeURIComponent(userRepoNewIssueMatch[2])}
      />
    );
  }

  const userRepoIssueMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)$/);
  if (userRepoIssueMatch) {
    return (
      <IssueDetailPage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoIssueMatch[1])}
        repoName={decodeURIComponent(userRepoIssueMatch[2])}
        number={Number(userRepoIssueMatch[3])}
      />
    );
  }

  const userRepoIssuesMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/issues$/);
  if (userRepoIssuesMatch) {
    return (
      <IssuesPage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoIssuesMatch[1])}
        repoName={decodeURIComponent(userRepoIssuesMatch[2])}
      />
    );
  }

  const userRepoPullsNewMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/pulls\/new$/);
  if (userRepoPullsNewMatch) {
    return (
      <NewPullRequestPage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoPullsNewMatch[1])}
        repoName={decodeURIComponent(userRepoPullsNewMatch[2])}
        base={location.search.get("base") ?? undefined}
        compare={location.search.get("compare") ?? undefined}
      />
    );
  }

  const userRepoPullMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/pulls\/(\d+)$/);
  if (userRepoPullMatch) {
    return (
      <PullRequestDetailPage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoPullMatch[1])}
        repoName={decodeURIComponent(userRepoPullMatch[2])}
        number={Number(userRepoPullMatch[3])}
      />
    );
  }

  const userRepoPullsMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/pulls$/);
  if (userRepoPullsMatch) {
    return (
      <PullRequestsPage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoPullsMatch[1])}
        repoName={decodeURIComponent(userRepoPullsMatch[2])}
      />
    );
  }

  const userRepoSearchMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)\/search$/);
  if (userRepoSearchMatch) {
    return (
      <CodeSearchPage
        ownerType="account"
        ownerName={decodeURIComponent(userRepoSearchMatch[1])}
        repoName={decodeURIComponent(userRepoSearchMatch[2])}
        branch={location.search.get("branch") ?? undefined}
      />
    );
  }

  const userRepoMatch = path.match(/^\/u\/([^/]+)\/repos\/([^/]+)$/);
  if (userRepoMatch) {
    return (
      <RepositoryView
        ownerType="account"
        ownerName={decodeURIComponent(userRepoMatch[1])}
        repoName={decodeURIComponent(userRepoMatch[2])}
        section="code"
        branch={location.search.get("branch") ?? undefined}
        path={location.search.get("path") ?? undefined}
      />
    );
  }

  return <HomePage />;
}

function accessModeFromPath(path: string): AccessMode | null {
  if (path.startsWith("/signin")) return "signin";
  if (path.startsWith("/signup")) return "signup";
  if (path.startsWith("/recover") || path.startsWith("/forgot-password")) return "recover";
  return null;
}
