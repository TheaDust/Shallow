import { FormEvent, useEffect, useState } from "react";

import {
  createFileCommit,
  CommitFieldErrors,
  fileHref,
  RepoOwnerType,
} from "../../lib/repo-api";
import { useSession } from "../../session";
import { RepoPageChrome } from "./RepoPageChrome";
import { useRepoDetail } from "./useRepoDetail";

interface FileEditorPageProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  mode: "new" | "edit";
  branch?: string;
  path?: string;
}

/**
 * The file editor form opened from “Add file” → “Create new file” or from
 * the file page's Edit button. One submission stores the path, content,
 * commit message, author, parent commit, and target branch as an indivisible
 * record and moves the branch head to the new commit. Field errors are shown
 * beside the fields and nothing is written when validation fails.
 */
export function FileEditorPage({ ownerType, ownerName, repoName, mode, branch, path }: FileEditorPageProps) {
  const { status: sessionStatus } = useSession();
  const { status: detailStatus, repository } = useRepoDetail(ownerType, ownerName, repoName, branch);
  const [fileName, setFileName] = useState(mode === "edit" ? (path ?? "") : "");
  const [contents, setContents] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [errors, setErrors] = useState<CommitFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode === "edit" && repository) {
      const current = (repository.files ?? []).find((file) => file.path === (path ?? ""));
      if (current) setContents(current.content);
    }
  }, [mode, repository, path]);

  const currentBranch = branch || repository?.currentBranch || repository?.defaultBranch || "main";
  const canWrite =
    sessionStatus === "authenticated" &&
    ["write", "maintain", "admin"].includes(repository?.currentRole ?? "");

  if (sessionStatus !== "authenticated") {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
        <p>Sign in to edit files.</p>
        <p>
          <a href="#/signin">Sign in</a>
        </p>
      </RepoPageChrome>
    );
  }

  if (detailStatus === "denied") {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
        <p>Access denied</p>
      </RepoPageChrome>
    );
  }

  if (detailStatus === "notfound") {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
        <p>Repository not found.</p>
      </RepoPageChrome>
    );
  }

  if (detailStatus !== "ready" || !repository) {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
        <p>Loading…</p>
      </RepoPageChrome>
    );
  }

  if (!canWrite) {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
        <p>You need write permission to edit files.</p>
      </RepoPageChrome>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    const outcome = await createFileCommit(ownerType, ownerName, repoName, {
      branch: currentBranch,
      path: fileName,
      content: contents,
      message: commitMessage,
    });
    setSubmitting(false);
    if (!outcome.ok) {
      setErrors(outcome.errors);
      return;
    }
    window.location.hash = fileHref(ownerType, ownerName, repoName, currentBranch, fileName.trim() || fileName);
  }

  return (
    <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
      <h2>{mode === "new" ? "Create new file" : "Edit file"}</h2>
      <p className="file-editor__branch">Branch: {currentBranch}</p>
      <form className="file-editor" onSubmit={(event) => void onSubmit(event)}>
        <div className="file-editor__field">
          <label htmlFor="file-name">File name</label>
          <input
            id="file-name"
            type="text"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            aria-invalid={Boolean(errors.path)}
            aria-describedby={errors.path ? "file-name-error" : undefined}
          />
          {errors.path && (
            <p id="file-name-error" className="field-error" role="alert">
              {errors.path}
            </p>
          )}
        </div>
        <div className="file-editor__field">
          <label htmlFor="file-contents">File contents</label>
          <textarea
            id="file-contents"
            name="file-contents"
            value={contents}
            onChange={(event) => setContents(event.target.value)}
            rows={10}
            spellCheck={false}
          />
        </div>
        <div className="file-editor__field">
          <label htmlFor="commit-message">Commit message</label>
          <input
            id="commit-message"
            type="text"
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? "commit-message-error" : undefined}
          />
          {errors.message && (
            <p id="commit-message-error" className="field-error" role="alert">
              {errors.message}
            </p>
          )}
        </div>
        {errors.branch && (
          <p className="field-error" role="alert">
            {errors.branch}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? "Committing…" : "Commit changes"}
        </button>
      </form>
    </RepoPageChrome>
  );
}
