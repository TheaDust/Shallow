import { useState, type FormEvent } from "react";

import { RepositoryLayout } from "../components/RepositoryLayout";
import { apiFieldErrors } from "../lib/api";
import { navigate, useHashLocation } from "../lib/hash-route";
import { createFile, fetchRepository, fetchUserRepository } from "../lib/organization-api";
import { repositoryCodePath, type RepositoryOwnerRef } from "../lib/routes";
import { apiErrorMessage, useAsyncData } from "../lib/use-async-data";
import { FILE_PATH_INVALID_MESSAGE, commitMessageError, isValidNewFilePath } from "../lib/write-rules";
import { useSession } from "../session/session-context";
import { Button, FormField } from "../ui";

export interface RepositoryNewFilePageProps {
  ownerType: "user" | "organization";
  owner: string;
  repository: string;
}

/**
 * The web file editor of one branch: “File name”, “File contents”, “Commit
 * message” and “Commit changes”. A submission the rules refuse (an invalid
 * path, or a missing or too long commit message) reports its field message and
 * writes nothing; a valid one creates exactly one commit and opens the new
 * file view. Only Write, Maintain, Admin or an organization Owner is let in.
 */
export function RepositoryNewFilePage({ ownerType, owner, repository }: RepositoryNewFilePageProps) {
  const { account } = useSession();
  const location = useHashLocation();
  const branchParam = location.search.get("branch") ?? undefined;
  const ownerRef: RepositoryOwnerRef = { type: ownerType, name: owner };
  const detail = useAsyncData(async () => {
    if (ownerType === "user") return fetchUserRepository(owner, repository, { branch: branchParam });
    const response = await fetchRepository(owner, repository, { branch: branchParam });
    return {
      ...response,
      owner: {
        type: "organization" as const,
        name: owner,
        displayName: response.organization.displayName,
      },
    };
  }, [ownerType, owner, repository, branchParam]);
  const loaded = detail.data;
  const defaultBranch = loaded?.repository.defaultBranch ?? "main";
  const branch = loaded?.branch ?? branchParam ?? defaultBranch;
  const files = loaded?.files ?? [];

  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ path?: string; message?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: { path?: string; message?: string } = {};
    if (!isValidNewFilePath(files, path)) nextErrors.path = FILE_PATH_INVALID_MESSAGE;
    const messageError = commitMessageError(message);
    if (messageError) nextErrors.message = messageError;
    setErrors(nextErrors);
    setFormError(null);
    // A refused submission stops here: no commit, no file and no branch change.
    if (nextErrors.path || nextErrors.message) return;

    setBusy(true);
    try {
      const created = await createFile(owner, repository, {
        path: path.trim(),
        content,
        message: message.trim(),
        branch,
      });
      navigate(
        repositoryCodePath(ownerRef, repository, {
          branch: created.branch === defaultBranch ? undefined : created.branch,
          file: created.path,
        }),
      );
    } catch (caught) {
      const fieldErrors = apiFieldErrors(caught);
      if (fieldErrors.path || fieldErrors.message) {
        setErrors({ path: fieldErrors.path, message: fieldErrors.message });
      } else {
        setFormError(apiErrorMessage(caught, "Unable to commit the file."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <RepositoryLayout
      owner={{ ...ownerRef, displayName: loaded?.owner.displayName ?? owner }}
      repositoryName={repository}
      activeSection="overview"
      canManage={loaded?.viewer.canManage ?? false}
      visibility={loaded?.repository.visibility ?? null}
      account={account}
      heading="Create new file"
    >
      {detail.loading ? <p role="status">Loading repository…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {loaded ? (
        <>
          <p className="revision-context">
            Branch: <span className="revision-context__value">{branch}</span>
          </p>
          <form className="file-editor" aria-label="Create new file" noValidate onSubmit={handleSubmit}>
            <FormField id="file-name" label="File name" error={errors.path}>
              <input
                id="file-name"
                type="text"
                autoComplete="off"
                value={path}
                onChange={(event) => setPath(event.target.value)}
              />
            </FormField>
            <FormField id="file-contents" label="File contents">
              <textarea
                id="file-contents"
                rows={12}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </FormField>
            <FormField id="commit-message" label="Commit message" error={errors.message}>
              <input
                id="commit-message"
                type="text"
                autoComplete="off"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </FormField>
            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="form-actions">
              <Button type="submit" variant="primary" disabled={busy}>
                Commit changes
              </Button>
            </div>
          </form>
        </>
      ) : null}
    </RepositoryLayout>
  );
}
