import { useSession } from '../App';

export default function HomePage() {
  const { user } = useSession();

  if (user) {
    return (
      <>
        <h1>Home</h1>
        <p className="workspace-greeting">Signed in as {user.username}</p>
      </>
    );
  }

  return (
    <>
      <h1>GitHub</h1>
      <p className="home-tagline">A simplified GitHub collaboration platform.</p>
      <nav className="home-links" aria-label="Account access">
        <a href="#/signup">Sign up</a>
        <a href="#/signin">Sign in</a>
        <a href="#/forgot-password">Forgot password</a>
      </nav>
    </>
  );
}
