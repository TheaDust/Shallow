import { useEffect, useState, type FormEvent } from "react";

import { errorMessageOf, fieldErrorsOf } from "../auth/api";
import { ApiError } from "../lib/api";
import { navigate } from "../lib/hash-route";
import { createRepositoryFile, fetchRepositoryView } from "../repositories/api";
import { repositoryBlobSuffix, repositoryPath } from "../repositories/routes";
import type { RepositoryOwnerKind, RepositoryView } from "../repositories/types";
import { Button, FormField, fieldDescriptionIds } from "../ui";

export interface RepositoryNewFilePageProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  /** Branch the added file belongs to; the commit advances this reference. */
  branch: string;
}

type LoadFailure = "notFound" | "denied" | "failed";

interface FileFormErrors {
  path?: string;
  message?: string;
}

const CREATE_ERROR = "We could not add the file. Try again.";

/**
 * "Create new file" editor of one branch, reached from the "Add file" menu of a
 * writable Code page. The editor exposes the "File name" field, the "File
 * contents" textbox, the "Commit message" field and the "Commit changes"
 * button, and it names the repository and the branch it writes to. Submitting
 * adds one commit on that branch; the server owns the path rule, the message
 * rule and the write permission, so a rejected submission stays on the form
 * with the returned reasons and changes neither the stored files nor the branch
 * head. A successful submission opens the read-only view of the added file.
 */
export function RepositoryNewFilePage({ ownerKind, owner, name, branch }: RepositoryNewFilePageProps) {
  const [repository, setRepository] = useState<RepositoryView | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FileFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRepository(null);
    setFailure(null);
    fetchRepositoryView(ownerKind, owner, name, branch)
      .then((next) => {
        if (!cancelled) setRepository(next);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setFailure("denied");
        else if (error instanceof ApiError && error.status === 404) setFailure("notFound");
        else setFailure("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [ownerKind, owner, name, branch]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const file = await createRepositoryFile({
        ownerKind,
        owner,
        name,
        branch: repository?.branch ?? branch,
        path,
        content,
        message,
      });
      navigate(repositoryPath(ownerKind, owner, name, repositoryBlobSuffix(file.branch, file.path)));
    } catch (error) {
      const fieldErrors = fieldErrorsOf(error);
      if (fieldErrors && (fieldErrors.path || fieldErrors.message)) {
        setErrors({ path: fieldErrors.path, message: fieldErrors.message });
      } else if (fieldErrors?.branch) {
        setFormError(fieldErrors.branch);
      } else {
        setFormError(errorMessageOf(error) ?? CREATE_ERROR);
      }
    } finally {
      setBusy(false);
    }
  }

  if (failure === "notFound") {
    return (
      <section className="page page--narrow">
        <h1>Repository not found</h1>
        <p className="page__lead">The address does not match a repository visible to you.</p>
      </section>
    );
  }

  if (failure === "denied") {
    return (
      <section className="page page--narrow">
        <h1>Access denied</h1>
        <p className="page__lead">Your account cannot read this private repository.</p>
      </section>
    );
  }

  if (failure === "failed") {
    return (
      <section className="page page--narrow">
        <p role="alert">We could not load this repository. Try again.</p>
      </section>
    );
  }

  if (!repository) {
    return (
      <section className="page">
        <p role="status">Loading repository…</p>
      </section>
    );
  }

  return (
    <section className="page">
      <nav className="repository-breadcrumb" aria-label="Repository">
        <a className="repository-breadcrumb__repository" href={`#${repositoryPath(ownerKind, owner, name)}`}>
          {repository.owner.name}/{repository.name}
        </a>
      </nav>
      <h1>Create new file</h1>
      <p className="repository-overview__meta">
        <span className="repository-new-file__branch">Branch {repository.branch}</span>
      </p>
      <form className="app-form" aria-label="Create new file" noValidate onSubmit={handleSubmit}>
        <FormField
          id="file-name"
          label="File name"
          error={errors.path}
          description="The path of the file inside this branch."
        >
          <input
            id="file-name"
            name="path"
            type="text"
            autoComplete="off"
            value={path}
            aria-describedby={fieldDescriptionIds("file-name", {
              description: true,
              error: Boolean(errors.path),
            })}
            onChange={(event) => setPath(event.target.value)}
          />
        </FormField>
        <FormField id="file-contents" label="File contents">
          <textarea
            id="file-contents"
            name="content"
            rows={10}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        </FormField>
        <FormField id="commit-message" label="Commit message" error={errors.message}>
          <input
            id="commit-message"
            name="message"
            type="text"
            autoComplete="off"
            value={message}
            aria-describedby={fieldDescriptionIds("commit-message", {
              description: false,
              error: Boolean(errors.message),
            })}
            onChange={(event) => setMessage(event.target.value)}
          />
        </FormField>
        {formError ? (
          <p className="app-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="app-form__actions">
          <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
            Commit changes
          </Button>
        </div>
      </form>
    </section>
  );
}
