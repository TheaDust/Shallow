import { useState } from "react";

import { ApiError } from "../../lib/api";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";

export interface IssueCommentFormProps {
  /**
   * Publishes one non-empty comment. It resolves with the server message of a
   * refused comment, or null when the comment was stored.
   */
  onSubmit(body: string): Promise<string | null>;
}

/** The exact message of a comment that holds nothing but whitespace. */
const COMMENT_REQUIRED = "Comment is required";

/**
 * The comment editor of an issue discussion: a textbox labeled `Comment` and a
 * submit button named exactly `Comment`. A whitespace-only comment is refused
 * with `Comment is required` and never reaches the server, so no partial
 * comment or activity record can be appended.
 */
export function IssueCommentForm({ onSubmit }: IssueCommentFormProps) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (body.trim().length === 0) {
      setError(COMMENT_REQUIRED);
      return;
    }
    setBusy(true);
    setError(null);
    onSubmit(body)
      .then((message) => {
        if (message === null) {
          setBody("");
          return;
        }
        setError(message);
      })
      .catch((failure) => {
        setError(failure instanceof ApiError ? failure.message : COMMENT_REQUIRED);
      })
      .finally(() => setBusy(false));
  }

  return (
    <form className="issue-comment-form" aria-label="New comment" onSubmit={submit}>
      <FormField id="issue-comment" label="Comment" error={error ?? undefined}>
        <textarea
          id="issue-comment"
          name="comment"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </FormField>
      <Button type="submit" variant="primary" disabled={busy}>
        Comment
      </Button>
    </form>
  );
}
