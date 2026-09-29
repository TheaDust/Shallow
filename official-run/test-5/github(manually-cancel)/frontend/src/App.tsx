import { AppHeader } from "./components/AppHeader";
import { useHashLocation, type HashLocation } from "./lib/hash-route";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/common";
import { OrganizationRoutes } from "./pages/organizations/OrganizationRoutes";
import { NewRepositoryPage } from "./pages/repositories/NewRepositoryPage";
import { RepositoryRoutes } from "./pages/repositories/RepositoryRoutes";
import { PasswordResetPage } from "./pages/PasswordResetPage";
import { PasswordSettingsPage } from "./pages/PasswordSettingsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { SessionProvider } from "./session/SessionProvider";

/**
 * Pages that render their own account-access links (a sign-in link while
 * signed out, or their own “Forgot password” entry), so the shared guest
 * navigation stays out of the way and no link name appears twice.
 */
const SELF_ACCESS_PATHS = new Set(["/login", "/settings", "/settings/password"]);

/** Path segments with percent-encoding removed (organization names may contain spaces). */
function pathSegments(path: string): string[] {
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

function AppRoutes({ location }: { location: HashLocation }) {
  const segments = pathSegments(location.path);
  const [first, ...rest] = segments;

  switch (first) {
    case undefined:
      return <HomePage />;
    case "login":
      return <SignInPage justRegistered={location.search.get("registered") === "1"} />;
    case "signup":
      return <RegisterPage />;
    case "forgot-password":
      return <PasswordResetPage />;
    case "settings":
      return rest[0] === "password" ? <PasswordSettingsPage /> : <SettingsPage />;
    case "organizations":
      return <OrganizationRoutes segments={rest} />;
    case "new":
      return <NewRepositoryPage />;
    case "repositories":
      return <RepositoryRoutes segments={rest} />;
    default:
      return <NotFoundPage />;
  }
}

export function App() {
  const location = useHashLocation();
  return (
    <SessionProvider>
      <AppHeader showGuestNavigation={!SELF_ACCESS_PATHS.has(location.path)} />
      <AppRoutes location={location} />
    </SessionProvider>
  );
}
