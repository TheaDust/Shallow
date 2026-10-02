import { type ReactNode } from "react";

import { SessionProvider, useSession } from "./auth/SessionContext";
import { AppTopBar } from "./layout/AppTopBar";
import { matchPath, useHashLocation } from "./lib/hash-route";
import { HomePage } from "./pages/HomePage";
import { NewOrganizationPage } from "./pages/NewOrganizationPage";
import { NewTeamPage } from "./pages/NewTeamPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OrganizationListPage } from "./pages/OrganizationListPage";
import {
  OrganizationOverviewPage,
  isOrganizationSection,
} from "./pages/OrganizationOverviewPage";
import { PasswordResetPage } from "./pages/PasswordResetPage";
import { PasswordSettingsPage } from "./pages/PasswordSettingsPage";
import { RepositoryManageAccessPage } from "./pages/RepositoryManageAccessPage";
import { RepositoryOverviewPage } from "./pages/RepositoryOverviewPage";
import { RepositorySettingsPage } from "./pages/RepositorySettingsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { SignInRequiredPage } from "./pages/SignInRequiredPage";
import { SignUpPage } from "./pages/SignUpPage";
import { TeamPage, isTeamSection } from "./pages/TeamPage";

/**
 * Hash routes of the account-access area. The single <main> landmark wraps the
 * page content and the top bar, so the current account stays on one page.
 */
export function App() {
  return (
    <SessionProvider>
      <AppLayout />
    </SessionProvider>
  );
}

function AppLayout() {
  const location = useHashLocation();

  return (
    <main className="app-main">
      <AppTopBar />
      <div className="app-page">{renderRoute(location.path)}</div>
    </main>
  );
}

/**
 * Routes that need an authenticated account always re-read the session, so a
 * signed-out visitor sees the sign-in entry instead of the protected page.
 */
function Protected({ children }: { children: ReactNode }) {
  const { status, account } = useSession();

  if (status === "loading") {
    return (
      <section className="page">
        <p role="status">Loading account…</p>
      </section>
    );
  }
  if (!account) return <SignInRequiredPage />;
  return <>{children}</>;
}

function renderRoute(path: string) {
  // Organization routes are matched before the plain account pages so that a
  // nested address such as /organizations/acme-demo/repositories/acme-docs
  // resolves to the repository overview instead of the not-found page.
  if (path === "/organizations") {
    return (
      <Protected>
        <OrganizationListPage />
      </Protected>
    );
  }
  if (path === "/organizations/new") {
    return (
      <Protected>
        <NewOrganizationPage />
      </Protected>
    );
  }

  // Team routes are matched before the organization sections so that
  // /organizations/acme-demo/teams/frontend-team/members resolves to the team
  // page instead of the organization not-found view.
  const newTeamParams = matchPath("/organizations/:slug/teams/new", path);
  if (newTeamParams) {
    return (
      <Protected>
        <NewTeamPage slug={newTeamParams.slug} />
      </Protected>
    );
  }

  const teamSectionParams = matchPath("/organizations/:slug/teams/:name/:section", path);
  if (teamSectionParams && isTeamSection(teamSectionParams.section)) {
    return (
      <TeamPage
        slug={teamSectionParams.slug}
        name={teamSectionParams.name}
        section={teamSectionParams.section}
      />
    );
  }

  const teamParams = matchPath("/organizations/:slug/teams/:name", path);
  if (teamParams) {
    return <TeamPage slug={teamParams.slug} name={teamParams.name} />;
  }

  const repositoryAccessParams = matchPath(
    "/organizations/:slug/repositories/:name/settings/:section",
    path,
  );
  if (repositoryAccessParams && repositoryAccessParams.section === "manage-access") {
    return (
      <Protected>
        <RepositoryManageAccessPage slug={repositoryAccessParams.slug} name={repositoryAccessParams.name} />
      </Protected>
    );
  }

  const repoSettingsParams = matchPath("/organizations/:slug/repositories/:name/settings", path);
  if (repoSettingsParams) {
    return (
      <Protected>
        <RepositorySettingsPage slug={repoSettingsParams.slug} name={repoSettingsParams.name} />
      </Protected>
    );
  }

  const repositoryParams = matchPath("/organizations/:slug/repositories/:name", path);
  if (repositoryParams) {
    return <RepositoryOverviewPage slug={repositoryParams.slug} name={repositoryParams.name} />;
  }

  const sectionParams = matchPath("/organizations/:slug/:section", path);
  if (sectionParams && isOrganizationSection(sectionParams.section)) {
    return <OrganizationOverviewPage slug={sectionParams.slug} section={sectionParams.section} />;
  }

  const organizationParams = matchPath("/organizations/:slug", path);
  if (organizationParams) {
    return <OrganizationOverviewPage slug={organizationParams.slug} />;
  }

  switch (path) {
    case "/":
      return <HomePage />;
    case "/login":
      return <SignInPage />;
    case "/signup":
      return <SignUpPage />;
    case "/forgot-password":
      return <PasswordResetPage />;
    case "/settings":
      return (
        <Protected>
          <SettingsPage />
        </Protected>
      );
    case "/settings/password":
      return (
        <Protected>
          <PasswordSettingsPage />
        </Protected>
      );
    default:
      return <NotFoundPage />;
  }
}
