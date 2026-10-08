import { useState, type FormEvent } from "react";

import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { ApiError } from "../lib/api";
import { navigate } from "../lib/hash-route";
import { createRepositoryFile, fetchRepository } from "../lib/org-api";
import { repositoryHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

/**
 * Web editor that adds one file to a branch (REQ-4-4). "File name",
 * "File contents", "Commit message" and "Commit changes" are the only fields; a
 * successful submission writes exactly one commit on the target branch and
 * opens the stored file, while an invalid path or commit message is reported on
 * the page and leaves the repository unchanged.
 */
export function RepositoryNewFilePage({
  owner,
  name,
  branch = "",
}: {
  owner: string;
  name: string;
  branch?: string;
}) {
  const { status, data, error } = useAsyncData(() => fetchRepository(owner, name), [owner, name]);
  const [fileName, setFileName] = useState("");
  const [contents, setContents] = useState("");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ path?: string; message?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const targetBranch = branch || data?.defaultBranch || "";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const result = await createRepositoryFile(owner, name, {
        path: fileName,
        content: contents,
        message,
        branch: targetBranch,
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors);
        if (!result.fieldErrors.path && !result.fieldErrors.message) setFormError(result.message);
        setSaving(false);
        return;
      }
      const file = result.value.file;
      const search = new URLSearchParams();
      if (branch) search.set("branch", branch);
      navigate(
        `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/blob/${encodeURIComponent(file.path)}`,
        search,
      );
    } catch (caught) {
      setFormError(
        caught instanceof ApiError
          ? caught.message
          : "Unable to commit the file. Please try again.",
      );
      setSaving(false);
    }
  };

  return (
    <main className="page">
      <section className="page__body repository-new-file">
        <nav className="repository__breadcrumb" aria-label="Breadcrumb">
          <a href={repositoryHash(owner, name)}>{data ? `${data.owner.displayName}/${data.name}` : name}</a>
        </nav>
        <h1 className="repository__title">Create new file</h1>
        {status === "loading" ? <LoadingNote label="Loading repository…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {status === "ready" && data ? (
          data.canWrite ? (
            <>
              <p className="repository-new-file__branch">Branch: {targetBranch}</p>
              <form className="repository-new-file__form" onSubmit={submit} noValidate>
                <FormField id="file-name" label="File name" error={fieldErrors.path}>
                  <input
                    id="file-name"
                    name="path"
                    type="text"
                    value={fileName}
                    onChange={(event) => setFileName(event.target.value)}
                  />
                </FormField>
                <FormField id="file-contents" label="File contents">
                  <textarea
                    id="file-contents"
                    name="content"
                    rows={12}
                    value={contents}
                    onChange={(event) => setContents(event.target.value)}
                  />
                </FormField>
                <FormField id="commit-message" label="Commit message" error={fieldErrors.message}>
                  <input
                    id="commit-message"
                    name="message"
                    type="text"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                </FormField>
                <Button type="submit" variant="primary" disabled={saving}>
                  Commit changes
                </Button>
                {formError ? (
                  <p className="repository-new-file__error" role="alert">
                    {formError}
                  </p>
                ) : null}
              </form>
            </>
          ) : (
            <p className="repository-new-file__hint">
              You need write permission on this repository to add a file.
            </p>
          )
        ) : null}
      </section>
    </main>
  );
}
