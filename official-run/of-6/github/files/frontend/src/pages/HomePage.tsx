import { useSession } from '../session';
import { WorkspaceView } from './WorkspacePage';

/**
 * Home page. Unauthenticated visitors see the account-access entries;
 * signed-in users see their workspace.
 */
export default function HomePage() {
  const { auth } = useSession();
  if (auth.status === 'ready' && auth.user) {
    return <WorkspaceView />;
  }
  return (
    <div className="home-page">
      <h1>GitHub Collaboration Platform</h1>
      <p className="home-tagline">A simplified GitHub collaboration platform.</p>
      <nav className="home-entries" aria-label="Account access">
        <a href="#/register">Sign up</a>
        <a href="#/signin">Sign in</a>
        <a href="#/forgot">Forgot password</a>
      </nav>
    </div>
  );
}
