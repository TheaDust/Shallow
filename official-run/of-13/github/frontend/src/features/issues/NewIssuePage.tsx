import { useState } from "react";

import { ApiError } from "../../lib/api";
import {
  canWriteRepositoryRole,
} from "../../lib/repository-code-api";
import {
  createRepositoryIssue,
  fetchRepositoryIssues,
  repositoryIssueHref,
  repositoryIssuesListHref,
  type RepositoryIssueList,
} from "../../lib/issues-api";
import { useDocumentTitle } from "../../lib/document-title";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";
import { useAccountSession } from "../account/AccountSession";
import { RepositoryHeader } from "../repositories/RepositoryHeader";
import {
  RepositoryLoading,
  RepositoryNotFound,
} from "../repositories/RepositoryPageStates";
import { useRepositoryResource } from "../repositories/useRepositoryResource";

export interface NewIssuePageProps {
  owner: string;
  name: string;
}

/**
 * The issue creation form of one repository, opened from the `New issue` link
 * of the Issues page. The repository identity decides whether the viewer may
 * create an issue at all; the server re-checks the Write permission and the
 * field rules of every submission, and the accepted issue opens its own detail
 * page.
 */
export function NewIssuePage({ owner, name }: NewIssuePageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const resource = useRepositoryResource<RepositoryIssueList>(
    `repository-new-issue:${owner}/${name}`,
    sessionStatus !== "loading",
    () => fetchRepositoryIssues(owner, name),
  );

  useDocumentTitle(`New issue · ${owner}/${name}`);

  if (resource.status === "missing" || resource.status === "error") {
    return <RepositoryNotFound />;
  }

  if (resource.status !== "ready") {
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  const { repository } = resource.value;
  const canWrite = canWriteRepositoryRole(repository.viewerRole);

  return (
    <div className="repository-new-issue">
      <RepositoryHeader
        owner={repository.owner}
        name={repository.name}
        visibility={repository.visibility}
        description={repository.description}
        defaultBranch={repository.defaultBranch}
        showSettings={Boolean(account)}
        active="issues"
        source={repository.source ?? null}
      />
      <h1 className="repository-new-issue__title">New issue</h1>
      {canWrite ? (
        <NewIssueForm key={`${owner}/${name}`} owner={owner} name={name} />
      ) : (
        <section className="repository-new-issue__denied" aria-label="New issue permission">
          <h2>Access denied</h2>
          <p>You do not have permission to create an issue in this repository.</p>
          {account ? null : (
            <p>
              <a href="#/login">Sign in</a>
            </p>
          )}
          <p>
            <a href={repositoryIssuesListHref(owner, name)}>{`Back to ${owner}/${name} issues`}</a>
          </p>
        </section>
      )}
    </div>
  );
}

interface NewIssueFormProps {
  owner: string;
  name: string;
}

function NewIssueForm({ owner, name }: NewIssueFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus(null);
    setFieldErrors({});
    createRepositoryIssue(owner, name, { title, description })
      .then((detail) => {
        // The accepted issue has its own page, addressed by its new number.
        window.location.hash = repositoryIssueHref(owner, name, detail.issue.number);
      })
      .catch((error) => {
        const body = error instanceof ApiError ? error.body : null;
        if (body && typeof body === "object" && "fieldErrors" in body) {
          setFieldErrors((body as { fieldErrors?: Record<string, string> }).fieldErrors ?? {});
        }
        // The message stays visible next to the fields, so a refusal never
        // leaves the impression that an issue was created.
        setStatus(error instanceof ApiError ? error.message : "The issue was not created.");
        setBusy(false);
      });
  }

  return (
    <form className="new-issue-form" aria-label="New issue" onSubmit={submit}>
      {status ? (
        <p className="new-issue-form__status" role="alert">
          {status}
        </p>
      ) : null}
      <FormField id="new-issue-title" label="Title" error={fieldErrors.title}>
        <input
          id="new-issue-title"
          name="title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
      <FormField id="new-issue-description" label="Description" error={fieldErrors.description}>
        <textarea
          id="new-issue-description"
          name="description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      <Button type="submit" variant="primary" disabled={busy}>
        Submit new issue
      </Button>
    </form>
  );
}
