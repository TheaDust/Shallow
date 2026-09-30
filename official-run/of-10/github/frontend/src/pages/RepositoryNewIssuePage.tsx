import { useState, type FormEvent } from "react";

import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { SignInRequired } from "../auth/SignInRequired";
import { useAuth } from "../auth/AuthProvider";
import { apiErrorMessage, readErrorFields } from "../lib/api";
import { navigate } from "../lib/hash-route";
import {
  canWriteIssues,
  createRepositoryIssue,
  issueDescriptionError,
  issueTitleError,
} from "../lib/issues-api";
import { repositoryIssuePath } from "../lib/repository-routes";
import { repositoryTitle } from "../lib/repositories-api";
import { useRepositoryIssues } from "../issue/useIssues";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { Button, FormField } from "../ui";

export interface RepositoryNewIssuePageProps {
  owner: string;
  name: string;
}

/**
 * The issue creation form of one repository (REQ-5-2-1), opened by the “New
 * issue” link of the Issues list. A submission stores the repository, title,
 * description, author, creation time, Open status and a creation activity as one
 * atomic write and then opens the new detail page; a blank or overlong input, a
 * missing session, a missing write permission or a failed request stores nothing
 * and keeps the reason on the form.
 */
export function RepositoryNewIssuePage({ owner, name }: RepositoryNewIssuePageProps) {
  const { status: authStatus, account } = useAuth();
  const { state } = useRepositoryIssues(owner, name);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (authStatus === "loading" || state.status === "loading") {
    return (
      <main aria-busy="true">
        <h1>New issue</h1>
        <p role="status">Loading the repository…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "missing") return <NotFoundPage hint={repositoryAccessHint()} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>New issue</h1>
        <p role="alert">The repository could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  const { repository } = state.value;
  const canCreate = canWriteIssues(repository.permissions?.role ?? null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const titleComplaint = issueTitleError(title);
    const descriptionComplaint = issueDescriptionError(description);
    setTitleError(titleComplaint);
    setDescriptionError(descriptionComplaint);
    if (titleComplaint || descriptionComplaint) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await createRepositoryIssue(owner, name, {
        title: title.trim(),
        description: description.trim(),
      });
      navigate(repositoryIssuePath(owner, name, payload.issue.number));
    } catch (caught) {
      const fields = readErrorFields(caught);
      setTitleError(fields.title ?? null);
      setDescriptionError(fields.description ?? null);
      if (!fields.title && !fields.description) {
        setError(apiErrorMessage(caught, "The issue could not be created."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <RepositoryChrome
        owner={owner}
        name={name}
        title={repositoryTitle(repository)}
        visibility={repository.visibility}
        description={repository.description}
        activeEntry="Issues"
      />
      <h1 className="issue-form__heading">New issue</h1>
      {!canCreate ? (
        account ? (
          <p className="issue-form__forbidden" role="status">
            You need write permission to create issues in this repository.
          </p>
        ) : (
          <SignInRequired />
        )
      ) : (
        <form className="issue-form" aria-label="New issue" onSubmit={submit}>
          <FormField id="issue-title" label="Title" error={titleError ?? undefined}>
            <input
              id="issue-title"
              className="issue-form__title"
              type="text"
              name="title"
              value={title}
              autoComplete="off"
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          <FormField id="issue-description" label="Description" error={descriptionError ?? undefined}>
            <textarea
              id="issue-description"
              className="issue-form__description"
              name="description"
              rows={6}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
          {error ? (
            <p className="form-message form-message--error" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy}>
            Submit new issue
          </Button>
        </form>
      )}
    </main>
  );
}
