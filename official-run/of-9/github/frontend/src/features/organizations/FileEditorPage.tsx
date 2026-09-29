import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "../../lib/api";
import { navigate, useHashLocation } from "../../lib/hash-route";
import { createRepositoryCommit, getRepositoryContents, type FieldErrors, type RepoRole } from "./api";
import { AccessDenied } from "./AccessDenied";
import { RepoPageHeader } from "./RepoPageHeader";

const WRITABLE_ROLES: RepoRole[] = ["write", "maintain", "admin"];

export function FileEditorPage({
  owner,
  name,
  mode,
}: {
  owner: string;
  name: string;
  mode: "new" | "edit";
}) {
  const location = useHashLocation();
  const branchParam = location.search.get("branch") ?? undefined;
  const pathParam = location.search.get("path") ?? "";
  const [branch, setBranch] = useState<string | null>(null);
  const [role, setRole] = useState<RepoRole | null>(null);
  const [fileName, setFileName] = useState(mode === "edit" ? pathParam : "");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [state, setState] = useState<"loading" | "ok" | "denied" | "missing">("loading");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    getRepositoryContents(owner, name, {
      branch: branchParam,
      path: mode === "edit" ? pathParam : undefined,
    })
      .then((contents) => {
        if (cancelled) return;
        setBranch(contents.branch);
        setRole(contents.myRole);
        if (mode === "edit" && contents.type === "file") {
          setFileName(contents.path);
          setContent(contents.content);
        } else if (mode === "edit") {
          setState("missing");
          return;
        }
        setState("ok");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setState("denied");
        else setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, branchParam, pathParam, mode]);

  if (state === "denied") return <AccessDenied />;
  if (state === "missing") {
    return (
      <section className="file-editor">
        <RepoPageHeader owner={owner} name={name} branch={branch ?? undefined} />
        <p className="file-editor__empty">File not found</p>
      </section>
    );
  }
  if (state === "loading" || !branch) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const writable = role !== null && WRITABLE_ROLES.includes(role);
  if (!writable) {
    return <AccessDenied />;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrors({});
    createRepositoryCommit(owner, name, {
      branch,
      path: fileName.trim(),
      content,
      message,
    })
      .then((result) => {
        if (result.ok) {
          navigate(
            `/repos/${owner}/${name}/blob`,
            new URLSearchParams({ branch, path: fileName.trim() }),
          );
          return;
        }
        setErrors(result.errors);
        setSubmitting(false);
      })
      .catch(() => {
        setErrors({ general: "Unable to save changes" });
        setSubmitting(false);
      });
  };

  return (
    <section className="file-editor">
      <RepoPageHeader owner={owner} name={name} branch={branch} context={mode === "edit" ? "Edit file" : "Create new file"} />
      <form className="file-editor__form" onSubmit={submit}>
        <div className="ui-field" data-invalid={Boolean(errors.path) || undefined}>
          <label htmlFor="file-editor-name">File name</label>
          <input
            id="file-editor-name"
            type="text"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
          />
          {errors.path ? (
            <p id="file-editor-name-error" className="ui-field__error" role="alert">
              {errors.path}
            </p>
          ) : null}
        </div>
        <div className="ui-field" data-invalid={Boolean(errors.content) || undefined}>
          <label htmlFor="file-editor-contents">File contents</label>
          <textarea
            id="file-editor-contents"
            rows={12}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          {errors.content ? (
            <p id="file-editor-contents-error" className="ui-field__error" role="alert">
              {errors.content}
            </p>
          ) : null}
        </div>
        <div className="ui-field" data-invalid={Boolean(errors.message) || undefined}>
          <label htmlFor="file-editor-message">Commit message</label>
          <input
            id="file-editor-message"
            type="text"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          {errors.message ? (
            <p id="file-editor-message-error" className="ui-field__error" role="alert">
              {errors.message}
            </p>
          ) : null}
        </div>
        {errors.general ? (
          <p role="alert" className="ui-field__error file-editor__general">
            {errors.general}
          </p>
        ) : null}
        <button type="submit" className="ui-button ui-button--primary" disabled={submitting}>
          Commit changes
        </button>
      </form>
    </section>
  );
}
