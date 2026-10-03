import { useEffect, useRef, type ReactNode } from "react";

import type { Account } from "./api/auth";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { SignOutDialog } from "./components/SignOutDialog";
import { navigate, useHashLocation, type HashLocation } from "./lib/hash-route";
import { matchRoute } from "./lib/routes";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { HomePage } from "./pages/HomePage";
import { NewOrganizationPage } from "./pages/organization/NewOrganizationPage";
import { NewTeamPage } from "./pages/organization/NewTeamPage";
import { OrganizationPage } from "./pages/organization/OrganizationPage";
import { OrganizationsPage } from "./pages/organization/OrganizationsPage";
import { RepositoryPage } from "./pages/organization/RepositoryPage";
import { RepositoryAccessPage } from "./pages/repository/RepositoryAccessPage";
import { RepositoryBranchesSettingsPage } from "./pages/repository/RepositoryBranchesSettingsPage";
import { RepositoryCodeSearchPage } from "./pages/repository/RepositoryCodeSearchPage";
import { RepositoryCommitPage } from "./pages/repository/RepositoryCommitPage";
import { RepositoryCommitsPage } from "./pages/repository/RepositoryCommitsPage";
import { RepositoryFilePage } from "./pages/repository/RepositoryFilePage";
import { RepositoryNewFilePage } from "./pages/repository/RepositoryNewFilePage";
import { RepositorySettingsPage } from "./pages/repository/RepositorySettingsPage";
import { RepositoryTreePage } from "./pages/repository/RepositoryTreePage";
import { ForkRepositoryPage } from "./pages/repository/ForkRepositoryPage";
import { NewRepositoryPage } from "./pages/repository/NewRepositoryPage";
import { PasswordSettingsPage } from "./pages/PasswordSettingsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { BusyPage, NotFoundPage } from "./pages/StatusPages";
import { TeamPage } from "./pages/team/TeamPage";

const DEFAULT_LOCATION: HashLocation = { path: "/", search: new URLSearchParams() };

function ProtectedPage({ children }: { children: (account: Account) => ReactNode }) {
  const { status, account } = useAuth();

  useEffect(() => {
    if (status === "anonymous") navigate("/");
  }, [status]);

  if (status === "loading") return <BusyPage />;
  if (!account) return <HomePage />;
  return <>{children(account)}</>;
}

function RouteView({ location }: { location: HashLocation }) {
  const route = matchRoute(location.path);
  const { org, team, repo } = route.params;

  switch (route.name) {
    case "home":
      return <HomePage />;
    case "search":
      return <SearchPage query={location.search.get("q") ?? ""} />;
    case "signin":
      return <SignInPage />;
    case "signup":
      return <RegisterPage />;
    case "forgot":
      return <ForgotPasswordPage />;
    case "settings":
      return <ProtectedPage>{(account) => <SettingsPage account={account} />}</ProtectedPage>;
    case "password-settings":
      return <ProtectedPage>{(account) => <PasswordSettingsPage account={account} />}</ProtectedPage>;
    case "organizations":
      return <ProtectedPage>{(account) => <OrganizationsPage account={account} />}</ProtectedPage>;
    case "new-organization":
      return <ProtectedPage>{(account) => <NewOrganizationPage account={account} />}</ProtectedPage>;
    case "organization":
      return <OrganizationPage slug={org} section="overview" />;
    case "organization-repositories":
      return <OrganizationPage slug={org} section="repositories" />;
    case "organization-people":
      return <OrganizationPage slug={org} section="people" />;
    case "organization-teams":
      return <OrganizationPage slug={org} section="teams" />;
    case "new-team":
      return <ProtectedPage>{(account) => <NewTeamPage slug={org} account={account} />}</ProtectedPage>;
    case "team":
      return <TeamPage slug={org} teamSlug={team} section="overview" />;
    case "team-members":
      return <TeamPage slug={org} teamSlug={team} section="members" />;
    case "team-settings":
      return <TeamPage slug={org} teamSlug={team} section="settings" />;
    case "repository":
      return <RepositoryPage slug={org} repositoryName={repo} />;
    case "repository-settings":
      return <RepositorySettingsPage slug={org} repositoryName={repo} />;
    case "repository-settings-branches":
      return <RepositoryBranchesSettingsPage slug={org} repositoryName={repo} />;
    case "repository-access":
      return <RepositoryAccessPage slug={org} repositoryName={repo} />;
    case "new-repository":
      return <ProtectedPage>{(account) => <NewRepositoryPage account={account} />}</ProtectedPage>;
    case "repository-fork":
      return (
        <ProtectedPage>
          {(account) => <ForkRepositoryPage account={account} ownerLogin={org} repositoryName={repo} />}
        </ProtectedPage>
      );
    case "repository-file":
      return (
        <RepositoryFilePage
          ownerLogin={org}
          repositoryName={repo}
          branch={route.params.branch}
          path={route.params.path}
        />
      );
    case "repository-new-file":
      return (
        <RepositoryNewFilePage
          ownerLogin={org}
          repositoryName={repo}
          branch={route.params.branch}
        />
      );
    case "repository-tree":
      return (
        <RepositoryTreePage
          ownerLogin={org}
          repositoryName={repo}
          branch={route.params.branch}
          path={route.params.path}
        />
      );
    case "repository-commits":
      return (
        <RepositoryCommitsPage
          ownerLogin={org}
          repositoryName={repo}
          branch={route.params.branch}
          path={route.params.path}
        />
      );
    case "repository-commit":
      return (
        <RepositoryCommitPage
          ownerLogin={org}
          repositoryName={repo}
          commitId={route.params.commitId}
        />
      );
    case "repository-code-search":
      return (
        <RepositoryCodeSearchPage
          ownerLogin={org}
          repositoryName={repo}
          query={location.search.get("q") ?? ""}
        />
      );
    default:
      return <NotFoundPage />;
  }
}

function AppRoutes() {
  const location = useHashLocation();
  const { status, account } = useAuth();
  const previous = useRef<HashLocation>(DEFAULT_LOCATION);
  if (location.path !== "/signout") previous.current = location;

  if (location.path === "/signout") {
    const back = previous.current.path === "/signout" ? DEFAULT_LOCATION : previous.current;
    if (status === "loading") return <BusyPage />;
    if (!account) return <HomePage />;
    return (
      <>
        <RouteView location={back} />
        <SignOutDialog open onDismiss={() => navigate(back.path, back.search)} />
      </>
    );
  }

  return <RouteView location={location} />;
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
