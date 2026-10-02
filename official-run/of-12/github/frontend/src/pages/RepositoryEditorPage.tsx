import { useEffect, useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import { navigate } from "../lib/hash-route";
import { readFormValues } from "../lib/forms";
import { RepositoryHeader } from "../features/repositories/RepositoryHeader";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { commitRepositoryFile } from "../features/repositories/repository-api";
import { useRepositoryContents } from "../features/repositories/use-repository-contents";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryEditorPageProps {
  owner: string;
  name: string;
  branch?: string;
  /** The file being edited; absent while creating a new file. */
  path?: string;
  mode: "create" | "edit";
}

const FIELD_NAMES = ["path", "content", "message"] as const;

/**
 * File editor of the Code page (REQ-4-4).
 *
 * The form submitted from "Create new file" (the "Add file" menu) or from the
 * "Edit" entry of a file page holds the "File name", the "File contents" and
 * the "Commit message" of the change. On submit the server stores the content,
 * the message, the author, the parent commit and the target branch as one
 * commit and moves the branch to it, so the file page that opens right after
 * shows the exact stored content; a rejected submit displays the reason and
 * leaves the file, the branch head and the history unchanged. The submit uses
 * the blocking transport, so the stored file address is already active when the
 * handler returns and an immediate reload keeps the saved file (REQ-4-4).
 */
export function RepositoryEditorPage({ owner, name, branch: requestedBranch, path, mode }: RepositoryEditorPageProps) {
  const { state: repositoryState, repository } = useRepositoryOverview(owner, name);
  const branch = requestedBranch ?? repository?.defaultBranch ?? "main";
  const editing = mode === "edit";
  const loaded = useRepositoryContents(
    owner,
    name,
    path ?? "",
    branch,
    Boolean(repository) && editing && Boolean(path),
  );
  const [values, setValues] = useState({ path: path ?? "", content: "", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!editing || !loaded.file) return;
    setValues((current) => ({ ...current, path: loaded.file?.path ?? current.path, content: loaded.file?.content ?? "" }));
  }, [editing, loaded.file]);

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;

  if (repository.canWrite !== true) {
    return (
      <main className="file-editor-page">
        <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="code" branch={branch} />
        <p role="alert">You do not have permission to edit files in this repository.</p>
      </main>
    );
  }

  const update = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitted = readFormValues(form, FIELD_NAMES);
    setValues({
      path: submitted.path ?? "",
      content: submitted.content ?? "",
      message: submitted.message ?? "",
    });
    setErrors({});
    setMessage(null);
    const result = commitRepositoryFile(owner, name, {
      branch,
      path: submitted.path ?? "",
      content: submitted.content ?? "",
      message: submitted.message ?? "",
      create: !editing,
      originalPath: editing ? path : undefined,
    });
    if (!result.ok) {
      setErrors(result.errors);
      const unmapped = Object.entries(result.errors).filter(([key]) => key !== "path" && key !== "message");
      setMessage(unmapped.length > 0 ? unmapped[0][1] : Object.keys(result.errors).length > 0 ? null : result.message);
      return;
    }
    const savedPath = result.data.path;
    navigate(`/${owner}/${name}/blob/${encodeURIComponent(branch)}/${savedPath}`, new URLSearchParams({ saved: savedPath }));
  };

  const missing = editing && loaded.state === "missing";
  const loadingContent = editing && loaded.state === "loading";

  return (
    <main className="file-editor-page">
      <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="code" branch={branch} />
      <h2 className="file-editor-page__title">{editing ? "Edit file" : "Create new file"}</h2>
      <p className="file-editor-page__branch">{`Branch ${branch}`}</p>
      {loadingContent ? <p role="status">Loading file…</p> : null}
      {missing ? <p role="alert">{`This file does not exist on branch ${branch}.`}</p> : null}
      {missing ? null : (
      <form className="file-editor" aria-label={editing ? "Edit file" : "Create new file"} onSubmit={submit} noValidate>
        <FormField id="file-editor-name" label="File name" error={errors.path}>
          <input
            id="file-editor-name"
            name="path"
            type="text"
            autoComplete="off"
            value={values.path}
            onChange={(event) => update("path")(event.target.value)}
          />
        </FormField>
        <FormField id="file-editor-contents" label="File contents">
          <textarea
            id="file-editor-contents"
            name="content"
            rows={12}
            value={values.content}
            onChange={(event) => update("content")(event.target.value)}
          />
        </FormField>
        <FormField id="file-editor-message" label="Commit message" error={errors.message}>
          <input
            id="file-editor-message"
            name="message"
            type="text"
            autoComplete="off"
            value={values.message}
            onChange={(event) => update("message")(event.target.value)}
          />
        </FormField>
        {message ? <p className="file-editor__error" role="alert">{message}</p> : null}
        <div className="file-editor__actions">
          <Button type="submit" variant="primary" disabled={loadingContent}>
            Commit changes
          </Button>
        </div>
      </form>
      )}
    </main>
  );
}
