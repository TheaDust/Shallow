import { type ReactNode } from "react";

import { SessionProvider, useSession } from "./auth/SessionContext";
import { AppTopBar } from "./layout/AppTopBar";
import { matchPath, useHashLocation } from "./lib/hash-route";
import { ForkRepositoryPage } from "./pages/ForkRepositoryPage";
import { HomePage } from "./pages/HomePage";
import { NewOrganizationPage } from "./pages/NewOrganizationPage";
import { NewRepositoryPage } from "./pages/NewRepositoryPage";
import { NewTeamPage } from "./pages/NewTeamPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OrganizationListPage } from "./pages/OrganizationListPage";
import {
  OrganizationOverviewPage,
  isOrganizationSection,
} from "./pages/OrganizationOverviewPage";
import { PasswordResetPage } from "./pages/PasswordResetPage";
import { PasswordSettingsPage } from "./pages/PasswordSettingsPage";
import { RepositoryBlobPage } from "./pages/RepositoryBlobPage";
import { RepositoryCodeSearchPage } from "./pages/RepositoryCodeSearchPage";
import { RepositoryCommitPage } from "./pages/RepositoryCommitPage";
import { RepositoryCommitsPage } from "./pages/RepositoryCommitsPage";
import { RepositoryManageAccessPage } from "./pages/RepositoryManageAccessPage";
import { RepositoryNewFilePage } from "./pages/RepositoryNewFilePage";
import { RepositoryOverviewPage } from "./pages/RepositoryOverviewPage";
import { RepositorySectionPage, isRepositorySection } from "./pages/RepositorySectionPage";
import { RepositorySettingsPage } from "./pages/RepositorySettingsPage";
import { RepositoryTreePage } from "./pages/RepositoryTreePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SearchResultsPage } from "./pages/SearchResultsPage";
import { SignInPage } from "./pages/SignInPage";
import { SignInRequiredPage } from "./pages/SignInRequiredPage";
import { SignUpPage } from "./pages/SignUpPage";
import { TeamPage, isTeamSection } from "./pages/TeamPage";
import { UserProfilePage } from "./pages/UserProfilePage";
import { NEW_REPOSITORY_PATH, matchRepositoryRoute } from "./repositories/routes";

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
      <div className="app-page">{renderRoute(location.path, location.search)}</div>
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

function renderRoute(path: string, search: URLSearchParams) {
  // The global search results live on their own address; the query is part of
  // the hash so a direct link or a reload repeats the same search.
  if (path === "/search") {
    return <SearchResultsPage query={search.get("q") ?? ""} />;
  }
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

  const repositoryRoute = matchRepositoryRoute(path);
  if (repositoryRoute) {
    const { view, ownerKind, owner, name } = repositoryRoute;
    if (view === "overview") {
      return (
        <RepositoryOverviewPage
          ownerKind={ownerKind}
          owner={owner}
          name={name}
          branch={search.get("branch") ?? ""}
        />
      );
    }
    if (view === "fork") {
      return (
        <Protected>
          <ForkRepositoryPage ownerKind={ownerKind} owner={owner} name={name} />
        </Protected>
      );
    }
    if (view === "blob") {
      return (
        <RepositoryBlobPage
          ownerKind={ownerKind}
          owner={owner}
          name={name}
          branch={repositoryRoute.branch ?? ""}
          path={repositoryRoute.path ?? ""}
        />
      );
    }
    if (view === "tree") {
      return (
        <RepositoryTreePage
          ownerKind={ownerKind}
          owner={owner}
          name={name}
          branch={repositoryRoute.branch ?? ""}
          path={repositoryRoute.path ?? ""}
        />
      );
    }
    if (view === "commits") {
      return (
        <RepositoryCommitsPage
          ownerKind={ownerKind}
          owner={owner}
          name={name}
          branch={repositoryRoute.branch ?? ""}
          path={repositoryRoute.path ?? ""}
        />
      );
    }
    if (view === "commit") {
      return (
        <RepositoryCommitPage
          ownerKind={ownerKind}
          owner={owner}
          name={name}
          commitId={repositoryRoute.commitId ?? ""}
        />
      );
    }
    if (view === "search") {
      return (
        <RepositoryCodeSearchPage
          ownerKind={ownerKind}
          owner={owner}
          name={name}
          query={search.get("q") ?? ""}
        />
      );
    }
    if (view === "new-file") {
      return (
        <RepositoryNewFilePage
          ownerKind={ownerKind}
          owner={owner}
          name={name}
          branch={repositoryRoute.branch ?? ""}
        />
      );
    }
    if (view === "section" && repositoryRoute.section && isRepositorySection(repositoryRoute.section)) {
      return (
        <RepositorySectionPage
          ownerKind={ownerKind}
          owner={owner}
          name={name}
          section={repositoryRoute.section}
        />
      );
    }
    if (view === "settings") {
      if (repositoryRoute.section === "manage-access") {
        // The access list is an organization-repository capability; a personal
        // repository has no such section.
        if (ownerKind !== "organization") return <NotFoundPage />;
        return (
          <Protected>
            <RepositoryManageAccessPage slug={owner} name={name} />
          </Protected>
        );
      }
      return (
        <Protected>
          <RepositorySettingsPage
            ownerKind={ownerKind}
            owner={owner}
            name={name}
            section={repositoryRoute.section}
          />
        </Protected>
      );
    }
    return <NotFoundPage />;
  }

  const sectionParams = matchPath("/organizations/:slug/:section", path);
  if (sectionParams && isOrganizationSection(sectionParams.section)) {
    return <OrganizationOverviewPage slug={sectionParams.slug} section={sectionParams.section} />;
  }

  const organizationParams = matchPath("/organizations/:slug", path);
  if (organizationParams) {
    return <OrganizationOverviewPage slug={organizationParams.slug} />;
  }

  const profileParams = matchPath("/users/:username", path);
  if (profileParams) {
    return <UserProfilePage username={profileParams.username} />;
  }

  switch (path) {
    case "/":
      return <HomePage />;
    case NEW_REPOSITORY_PATH:
      return (
        <Protected>
          <NewRepositoryPage />
        </Protected>
      );
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
