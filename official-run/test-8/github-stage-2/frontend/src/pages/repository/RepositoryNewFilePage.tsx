import { useState, type FormEvent } from "react";

import { fieldErrorsOf, messageOf, type FieldErrors } from "../../api/auth";
import {
  canWriteRepositoryRole,
  createRepositoryFile,
  fetchRepository,
} from "../../api/organizations";
import { useAuth } from "../../auth/AuthProvider";
import { CodeBreadcrumb } from "../../components/CodeBreadcrumb";
import { SiteHeader } from "../../components/SiteHeader";
import { navigate } from "../../lib/hash-route";
import { blobPath } from "../../lib/repository-paths";
import { useAsyncData } from "../../lib/useAsyncData";
import { Button, FormField } from "../../ui";

/**
 * The web file editor of REQ-4-4: “Add file” → “Create new file”.
 *
 * The editor exposes the “File name”, “File contents” and “Commit message”
 * fields and the “Commit changes” button; submitting creates one commit on the
 * current branch and lands on the file view of the new content. Validation is
 * answered by the server (path, commit message, permission), so a rejected
 * submission is reported on the page and nothing is written. Only Write and
 * above receive the editor at all; Read and Triage only browse.
 */
export function RepositoryNewFilePage({
  ownerLogin,
  repositoryName,
  branch,
}: {
  ownerLogin: string;
  repositoryName: string;
  branch: string;
}) {
  const { account } = useAuth();
  const { data, error, loading } = useAsyncData(
    () => fetchRepository(ownerLogin, repositoryName),
    [ownerLogin, repositoryName],
  );
  const repository = data?.repository ?? null;
  const ownerName = repository?.owner?.displayName ?? ownerLogin;
  const canWrite = canWriteRepositoryRole(repository?.role);
  const [fileName, setFileName] = useState("");
  const [contents, setContents] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await createRepositoryFile(ownerLogin, repositoryName, {
        branch,
        path: fileName,
        content: contents,
        message,
      });
      navigate(blobPath(ownerLogin, repositoryName, result.branch, result.path));
    } catch (failure) {
      const fields = fieldErrorsOf(failure);
      if (Object.keys(fields).length > 0) setErrors(fields);
      else setFormError(messageOf(failure, "File creation failed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <main>
      <SiteHeader account={account} showGlobalSearch={false} />
      <CodeBreadcrumb
        ownerLogin={ownerLogin}
        ownerName={ownerName}
        repositoryName={repositoryName}
        branch={branch}
        path=""
        kind="directory"
      />
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {repository && !error ? (
        <>
          <h1>Create new file</h1>
          {canWrite ? (
            <form
              className="account-form"
              aria-label="Create new file"
              noValidate
              onSubmit={(event) => void submit(event)}
            >
              <FormField id="new-file-name" label="File name" error={errors.path}>
                <input
                  id="new-file-name"
                  name="fileName"
                  type="text"
                  autoComplete="off"
                  value={fileName}
                  onChange={(event) => setFileName(event.target.value)}
                />
              </FormField>
              <FormField id="new-file-contents" label="File contents">
                <textarea
                  id="new-file-contents"
                  name="contents"
                  rows={10}
                  value={contents}
                  onChange={(event) => setContents(event.target.value)}
                />
              </FormField>
              <FormField id="new-file-message" label="Commit message" error={errors.message}>
                <input
                  id="new-file-message"
                  name="message"
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
              <Button type="submit" variant="primary" disabled={pending}>
                Commit changes
              </Button>
            </form>
          ) : (
            <p className="settings-note" role="status">
              You do not have permission to add files to this repository.
            </p>
          )}
        </>
      ) : null}
    </main>
  );
}
