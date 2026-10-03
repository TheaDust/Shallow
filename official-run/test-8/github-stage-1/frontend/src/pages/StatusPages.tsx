import { makeHash } from "../lib/hash-route";

export function BusyPage() {
  return (
    <main>
      <p role="status">Loading…</p>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>This page does not exist.</p>
      <p>
        <a href={makeHash("/")}>Home</a>
      </p>
    </main>
  );
}
