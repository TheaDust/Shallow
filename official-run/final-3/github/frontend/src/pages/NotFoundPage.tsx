import { AppHeader } from "../components/AppHeader";

export function NotFoundPage() {
  return (
    <main className="page">
      <AppHeader />
      <section className="page__body">
        <h1>Page not found</h1>
        <p>
          <a href="#/">Go to Home</a>
        </p>
      </section>
    </main>
  );
}
