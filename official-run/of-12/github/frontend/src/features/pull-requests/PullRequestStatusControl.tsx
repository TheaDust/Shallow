import { Button } from "../../ui";
import type { PullRequestDetail } from "./pull-request-api";

export interface PullRequestStatusControlProps {
  pullRequest: PullRequestDetail;
  working: boolean;
  error: string | null;
  onClose(): void;
  onReopen(): void;
}

/**
 * The close and reopen entries of a pull request detail page (REQ-6-6).
 *
 * The author, a Maintain, an Admin and an organization Owner close an unmerged
 * Open or Draft pull request and reopen a Closed one; every other viewer gets
 * neither button, so the page offers no unavailable operation. Closing is
 * immediate — there is no confirmation dialog — and it changes only the stored
 * status, the operator and the time: no branch moves and the discussion,
 * reviews and diff stay viewable. A Merged pull request is terminal and
 * therefore spells no close or reopen operation at all.
 */
export function PullRequestStatusControl({
  pullRequest,
  working,
  error,
  onClose,
  onReopen,
}: PullRequestStatusControlProps) {
  const { permissions } = pullRequest;
  if (!permissions.canClose && !permissions.canReopen) return null;

  return (
    <section className="pull-request-status" aria-label="Pull request status actions">
      {permissions.canClose ? (
        <Button variant="danger" disabled={working} onClick={onClose}>
          Close pull request
        </Button>
      ) : null}
      {permissions.canReopen ? (
        <Button variant="primary" disabled={working} onClick={onReopen}>
          Reopen pull request
        </Button>
      ) : null}
      {error ? (
        <p className="pull-request-status__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
