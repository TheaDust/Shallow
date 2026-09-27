import type { User } from '../api';

export default function HomePage({ session }: { session: User | null }) {
  if (session) {
    return (
      <main className="workspace-page">
        <h1>Your workspace</h1>
        <p>Signed in as {session.username}</p>
        <p className="muted">Organizations, repositories, and work items appear here.</p>
      </main>
    );
  }

  return (
    <main className="home-page">
      <h1>GitHub</h1>
      <p className="tagline">Where the world builds software.</p>
      <nav className="home-links" aria-label="Account">
        <a className="home-link" href="#/register">
          Sign up
        </a>
        <a className="home-link" href="#/signin">
          Sign in
        </a>
        <a className="home-link" href="#/forgot">
          Forgot password
        </a>
      </nav>
    </main>
  );
}
