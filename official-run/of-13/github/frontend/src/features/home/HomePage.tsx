export function HomePage() {
  return (
    <>
      <h1>GitHub Collaboration Platform</h1>
      <p>Plan, build and ship software together.</p>
      <nav className="home-links" aria-label="Account access">
        <ul>
          <li>
            <a href="#/signup">Sign up</a>
          </li>
          <li>
            <a href="#/login">Sign in</a>
          </li>
          <li>
            <a href="#/forgot-password">Forgot password</a>
          </li>
        </ul>
      </nav>
    </>
  );
}
