import { useEffect } from "react";

import { navigate, useHashLocation } from "./lib/hash-route";
import { isProtectedView, matchRoute } from "./lib/routes";
import { HomePage } from "./pages/HomePage";
import { NewOrganizationPage } from "./pages/NewOrganizationPage";
import { NewTeamPage } from "./pages/NewTeamPage";
import { OrganizationOverviewPage } from "./pages/OrganizationOverviewPage";
import { OrganizationPeoplePage } from "./pages/OrganizationPeoplePage";
import { OrganizationRepositoriesPage } from "./pages/OrganizationRepositoriesPage";
import { OrganizationTeamsPage } from "./pages/OrganizationTeamsPage";
import { PasswordSettingsPage } from "./pages/PasswordSettingsPage";
import { RecoveryPage } from "./pages/RecoveryPage";
import { RepositoryAccessPage } from "./pages/RepositoryAccessPage";
import { RepositoryOverviewPage } from "./pages/RepositoryOverviewPage";
import { RepositorySettingsPage } from "./pages/RepositorySettingsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { TeamMembersPage } from "./pages/TeamMembersPage";
import { TeamOverviewPage } from "./pages/TeamOverviewPage";
import { TeamSettingsPage } from "./pages/TeamSettingsPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { YourOrganizationsPage } from "./pages/YourOrganizationsPage";
import { SessionProvider, useSession } from "./session/session-context";

function RedirectToHome() {
  useEffect(() => {
    navigate("/");
  }, []);
  return <HomePage />;
}

function Routes() {
  const { path } = useHashLocation();
  const { account, status } = useSession();
  const route = matchRoute(path);

  if (status === "loading") {
    return (
      <main>
        <p role="status">Loading…</p>
      </main>
    );
  }

  if (!account && isProtectedView(route)) {
    // A protected page opened without a session restores an unauthenticated
    // state and offers the “Sign in” entry again.
    return <RedirectToHome />;
  }

  switch (route.view) {
    case "signin":
      return <SignInPage />;
    case "signup":
      return <SignUpPage />;
    case "recover":
      return <RecoveryPage />;
    case "workspace":
      return <WorkspacePage account={account!} />;
    case "settings":
      return <SettingsPage account={account!} />;
    case "settings-password":
      return <PasswordSettingsPage account={account!} />;
    case "organizations":
      return <YourOrganizationsPage account={account!} />;
    case "organizations-new":
      return <NewOrganizationPage account={account!} />;
    case "organization-overview":
      return <OrganizationOverviewPage organization={route.organization} />;
    case "organization-repositories":
      return <OrganizationRepositoriesPage organization={route.organization} />;
    case "repository-overview":
      return <RepositoryOverviewPage organization={route.organization} repository={route.repository} />;
    case "repository-settings":
      return <RepositorySettingsPage organization={route.organization} repository={route.repository} />;
    case "repository-access":
      return <RepositoryAccessPage organization={route.organization} repository={route.repository} />;
    case "organization-people":
      return <OrganizationPeoplePage organization={route.organization} />;
    case "organization-teams":
      return <OrganizationTeamsPage organization={route.organization} />;
    case "organization-team-new":
      return <NewTeamPage organization={route.organization} />;
    case "team-overview":
      return <TeamOverviewPage organization={route.organization} team={route.team} />;
    case "team-members":
      return <TeamMembersPage organization={route.organization} team={route.team} />;
    case "team-settings":
      return <TeamSettingsPage organization={route.organization} team={route.team} />;
    default:
      return <HomePage />;
  }
}

export function App() {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}
