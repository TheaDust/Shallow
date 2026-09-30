import { useState, type FormEvent } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import { commitRepositoryFile } from "../lib/repository-edits-api";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

export interface FileEditorFormProps {
  owner: string;
  name: string;
  branch: string;
  /** Stored path when an existing file is edited, "" when a file is created. */
  initialPath: string;
  initialContent: string;
  onCommitted(path: string, branch: string): void;
}

/**
 * The file editor form (REQ-4-4): a `File name` field holding the path, a
 * `File contents` textbox and an initially empty `Commit message`, submitted
 * with `Commit changes`. The server validates the path, the message and the
 * viewer's role in one atomic write and reports its reason per field, so a
 * refused submission leaves the file, the branch head and the history unchanged.
 */
export function FileEditorForm({
  owner,
  name,
  branch,
  initialPath,
  initialContent,
  onCommitted,
}: FileEditorFormProps) {
  const [filePath, setFilePath] = useState(initialPath);
  const [content, setContent] = useState(initialContent);
  const [message, setMessage] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setPathError(null);
    setMessageError(null);
    setError(null);
    try {
      const payload = await commitRepositoryFile(owner, name, {
        branch,
        path: filePath,
        content,
        message,
        ...(initialPath ? { previousPath: initialPath } : {}),
      });
      onCommitted(payload.file.path, payload.file.branch);
    } catch (caught) {
      const fields = readErrorFields(caught);
      setPathError(fields.path ?? null);
      setMessageError(fields.message ?? null);
      if (!fields.path && !fields.message) {
        setError(apiErrorMessage(caught, "The file could not be saved."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="repository-form" aria-label="File editor" onSubmit={submit}>
      <FormField
        id="file-name"
        label="File name"
        description="Include the directory path, for example docs/guide.md."
        error={pathError ?? undefined}
        required
      >
        <input
          id="file-name"
          type="text"
          autoComplete="off"
          value={filePath}
          onChange={(event) => setFilePath(event.target.value)}
        />
      </FormField>
      <FormField id="file-contents" label="File contents">
        <textarea
          id="file-contents"
          className="file-editor__contents"
          rows={14}
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </FormField>
      <FormField id="commit-message" label="Commit message" error={messageError ?? undefined} required>
        <input
          id="commit-message"
          type="text"
          autoComplete="off"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </FormField>
      {error ? (
        <p role="alert" className="form-message form-message--error">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={busy}>
        Commit changes
      </Button>
    </form>
  );
}
