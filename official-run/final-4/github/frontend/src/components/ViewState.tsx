import type { AsyncError } from "../lib/use-async";
import { Button } from "../ui/Button";

export function LoadingNote({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="view-note" role="status">
      {label}
    </p>
  );
}

/** Full-page failure state: the message itself is the visible heading. */
export function ErrorHeading({ error }: { error: AsyncError }) {
  return <h1 className="view-error__title">{error.message}</h1>;
}

export function ErrorNote({ error, onRetry }: { error: AsyncError; onRetry?(): void }) {
  return (
    <div className="view-error">
      <p className="view-error__message" role="alert">
        {error.message}
      </p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
