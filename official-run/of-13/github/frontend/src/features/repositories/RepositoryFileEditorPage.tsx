import { useState } from "react";

import { ApiError } from "../../lib/api";
import {
  canWriteRepositoryRole,
  commitRepositoryFile,
  fetchRepositoryBlob,
  fetchRepositoryBranchSettings,
  fetchRepositoryTree,
  repositoryCodeHref,
  type RepositoryCodeIdentity,
} from "../../lib/repository-code-api";
import { useDocumentTitle } from "../../lib/document-title";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";
import { useAccountSession } from "../account/AccountSession";
import { RepositoryHeader } from "./RepositoryHeader";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "./RepositoryPageStates";
import { useRepositoryResource } from "./useRepositoryResource";
import { commitMessageError, filePathError } from "./write-validation";

export interface RepositoryFileEditorPageProps {
  owner: string;
  name: string;
  branch: string;
  /** Empty opens the new-file form; otherwise the stored file is edited. */
  path: string;
}

interface FileEditorData {
  repository: RepositoryCodeIdentity;
  branch: string;
  branches: string[];
  /** The stored content of `path`, or "" for a new file. */
  content: string;
  /** True when a branch protection rule binds exactly this branch name. */
  protectedBranch: boolean;
}

/**
 * The file editor opened from `Add file` → `Create new file` or from `Edit` on
 * a file page. One submission stores the file change, the message and the
 * author as a single commit and moves the branch to it; the server re-checks
 * the Write permission, the path rules and the message length.
 */
export function RepositoryFileEditorPage({
  owner,
  name,
  branch,
  path,
}: RepositoryFileEditorPageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const editor = useRepositoryResource<FileEditorData>(
    `repository-file-editor:${owner}/${name}:${branch}:${path}`,
    sessionStatus !== "loading",
    async () => {
      const tree = await fetchRepositoryTree(owner, name, { branch });
      let content = "";
      if (path.length > 0) {
        const blob = await fetchRepositoryBlob(owner, name, { branch, path });
        content = blob.content;
      }
      // A protected branch refuses direct writes, so the editor states the
      // protection up front; an unreadable settings payload simply leaves the
      // notice out.
      let protectedBranch = false;
      try {
        const settings = await fetchRepositoryBranchSettings(owner, name);
        protectedBranch = settings.branchProtectionRules.some(
          (rule) => rule.branchName === tree.branch,
        );
      } catch {
        protectedBranch = false;
      }
      return {
        repository: tree.repository,
        branch: tree.branch,
        branches: tree.branches,
        content,
        protectedBranch,
      };
    },
  );

  useDocumentTitle(`${path.length > 0 ? `Edit ${path}` : "Create new file"} · ${owner}/${name}`);

  if (editor.status === "denied") {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }
  if (editor.status === "missing" || editor.status === "error") {
    return <RepositoryNotFound />;
  }
  if (editor.status !== "ready") {
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  return (
    <RepositoryFileEditorForm
      key={`${owner}/${name}:${branch}:${path}`}
      owner={owner}
      name={name}
      initial={editor.value}
      initialPath={path}
      signedIn={Boolean(account)}
    />
  );
}

interface RepositoryFileEditorFormProps {
  owner: string;
  name: string;
  initial: FileEditorData;
  initialPath: string;
  signedIn: boolean;
}

function RepositoryFileEditorForm({
  owner,
  name,
  initial,
  initialPath,
  signedIn,
}: RepositoryFileEditorFormProps) {
  const repository = initial.repository;
  const branch = initial.branch;
  const canWrite = canWriteRepositoryRole(repository.viewerRole);
  const [fileName, setFileName] = useState(initialPath);
  const [contents, setContents] = useState(initial.content);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    const pathReason = filePathError(fileName);
    if (pathReason) errors.path = pathReason;
    const messageReason = commitMessageError(message);
    if (messageReason) errors.message = messageReason;
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setStatus(null);
      return;
    }

    setBusy(true);
    setStatus(null);
    commitRepositoryFile(owner, name, {
      branch,
      path: fileName.trim(),
      content: contents,
      message,
      previousPath: initialPath.length > 0 ? initialPath : undefined,
    })
      .then((result) => {
        window.location.hash = repositoryCodeHref(owner, name, "blob", result.branch, result.path);
      })
      .catch((error) => {
        const body = error instanceof ApiError ? error.body : null;
        if (body && typeof body === "object" && "fieldErrors" in body) {
          setFieldErrors((body as { fieldErrors?: Record<string, string> }).fieldErrors ?? {});
        }
        setStatus(error instanceof ApiError ? error.message : "The file was not saved.");
        setBusy(false);
      });
  }

  return (
    <div className="repository-file-editor">
      <RepositoryHeader
        owner={repository.owner}
        name={repository.name}
        visibility={repository.visibility}
        description={repository.description}
        defaultBranch={repository.defaultBranch}
        showSettings={signedIn}
        active="code"
        source={repository.source ?? null}
        branch={{
          branch,
          branches: initial.branches,
          hrefForBranch: (nextBranch) =>
            repositoryCodeHref(owner, name, "tree", nextBranch, ""),
          canWrite,
        }}
      />
      <h1 className="repository-file-editor__title">
        {initialPath.length > 0 ? "Edit file" : "Create new file"}
      </h1>
      <p className="repository-file-editor__context">
        <span>{`${repository.owner}/${repository.name}`}</span>
        <span>{`Branch: ${branch}`}</span>
      </p>
      {initial.protectedBranch ? (
        <p className="repository-file-editor__notice" role="status">
          {`The branch ${branch} is protected by a branch protection rule: a direct commit to it is refused. Choose an unprotected branch to commit this change.`}
        </p>
      ) : null}
      {status ? (
        <p className="repository-file-editor__status" role="alert">
          {status}
        </p>
      ) : null}
      <form className="repository-file-editor__form" aria-label="File editor" onSubmit={submit}>
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
        <Button type="submit" variant="primary" disabled={busy}>
          Commit changes
        </Button>
      </form>
    </div>
  );
}
