import { useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import { navigate } from "../lib/hash-route";
import { readFormValues } from "../lib/forms";
import { useSession } from "../lib/session";
import { createRepositoryIssueSync } from "../features/issues/issue-api";
import { issuePath } from "../features/issues/issue-links";
import { useRepositoryIssues } from "../features/issues/use-issues";
import { RepositoryHeader } from "../features/repositories/RepositoryHeader";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface NewIssuePageProps {
  owner: string;
  name: string;
}

const FIELD_IDS = {
  title: "new-issue-title",
  description: "new-issue-description",
};

/**
 * The issue creation form of the current repository (REQ-5-2-1).
 *
 * It is reached through the “New issue” link of the Issues list page, holds the
 * fields “Title” and “Description” and the button “Submit new issue”. Only Write,
 * Maintain and Admin may submit: the server stores the new record — the
 * repository identifier, the trimmed title, the description, the author, the
 * creation time and the Open status — together with its repository-scoped number
 * and the creation activity, and only then is the detail address of the new issue
 * opened. A blank or overlong title, an overlong description, a missing
 * permission or a failed write shows the reason and allocates no number.
 */
export function NewIssuePage({ owner, name }: NewIssuePageProps) {
  const { state: repositoryState, repository } = useRepositoryOverview(owner, name);
  const { state, payload } = useRepositoryIssues(owner, name, repositoryState === "ready");
  const { user, loading } = useSession();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;

  const canCreate = payload?.permissions.canCreateIssue === true;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = readFormValues(event.currentTarget, ["title", "description"]);
    setErrors({});
    setMessage(null);
    setSubmitting(true);
    const result = createRepositoryIssueSync(owner, name, {
      title: values.title ?? "",
      description: values.description ?? "",
    });
    if (!result.ok) {
      setSubmitting(false);
      setErrors(result.errors);
      setMessage(result.errors.title || result.errors.description ? null : result.message);
      return;
    }
    // The stored issue exists before the detail address becomes active, so a
    // reload of the destination reads the very same record.
    navigate(issuePath(repository, result.data.issue.number));
  };

  return (
    <main className="new-issue-page">
      <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="issues" />
      <section className="new-issue" aria-label="New issue">
        <h2>New issue</h2>
        {loading || state === "loading" || state === "idle" ? <p role="status">Loading…</p> : null}
        {!loading && !user ? (
          <p className="new-issue__signed-out">
            You need to sign in to create an issue. <a href="#/sign-in">Sign in</a>
          </p>
        ) : null}
        {state === "ready" && user && !canCreate ? (
          <p role="alert">You do not have permission to create an issue in this repository.</p>
        ) : null}
        {canCreate ? (
          <form className="issue-form" onSubmit={onSubmit} noValidate>
            <FormField id={FIELD_IDS.title} label="Title" error={errors.title}>
              <input id={FIELD_IDS.title} name="title" type="text" autoComplete="off" />
            </FormField>
            <FormField id={FIELD_IDS.description} label="Description" error={errors.description}>
              <textarea id={FIELD_IDS.description} name="description" rows={6} />
            </FormField>
            {message ? (
              <p className="issue-form__error" role="alert">
                {message}
              </p>
            ) : null}
            <Button type="submit" variant="primary" disabled={submitting}>
              Submit new issue
            </Button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
