import { useId, useState } from "react";

import { Button } from "../../ui";
import type { FileDiff } from "./api";

export interface InlineDiffComment {
  id: string;
  path: string;
  line: number; // 1-based position in the file's diff lines
  commitId: string;
  author: string;
  body: string;
  state: "published" | "pending";
  createdAt: string;
  outdated: boolean;
}

export type CommentSubmitResult = { ok: boolean; error?: string };

export interface DiffEditorState {
  path: string;
  line: number;
  body: string;
  error: string | null;
  busy: boolean;
}

function CommentBlock({ comment }: { comment: InlineDiffComment }) {
  return (
    <article className="diff-comment">
      <p className="diff-comment__meta">
        <strong>{comment.author}</strong>
        {comment.state === "pending" ? (
          <span className="diff-comment__badge diff-comment__badge--pending">Pending review</span>
        ) : null}
        {comment.outdated ? (
          <span className="diff-comment__badge diff-comment__badge--outdated">Outdated</span>
        ) : null}
      </p>
      <p className="diff-comment__body">{comment.body}</p>
    </article>
  );
}

function CommentEditor({
  value,
  error,
  busy,
  onChange,
  onSubmit,
  onStartReview,
}: {
  value: string;
  error: string | null;
  busy: boolean;
  onChange(value: string): void;
  onSubmit(): void;
  onStartReview(): void;
}) {
  const id = useId();
  return (
    <div className="diff-comment-editor">
      <div className="ui-field">
        <label htmlFor={id}>Comment</label>
        <textarea
          id={id}
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="diff-comment-editor__error">
          {error}
        </p>
      ) : null}
      <div className="diff-comment-editor__actions">
        <Button variant="primary" disabled={busy} onClick={onSubmit}>
          Add single comment
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onStartReview}>
          Start a review
        </Button>
      </div>
    </div>
  );
}

function DiffLines({
  lines,
  path,
  canComment,
  comments,
  editor,
  onAddComment,
  onChangeBody,
  onSubmit,
  onStartReview,
}: {
  lines: FileDiff["lines"];
  path: string;
  canComment: boolean;
  comments: InlineDiffComment[];
  editor: DiffEditorState | null;
  onAddComment(path: string, line: number): void;
  onChangeBody(body: string): void;
  onSubmit(path: string, line: number): void;
  onStartReview(path: string, line: number): void;
}) {
  return (
    <div className="diff-lines">
      {lines.map((entry, index) => {
        const position = index + 1;
        const commentable = canComment && (entry.type === "add" || entry.type === "del");
        const lineComments = comments.filter((comment) => comment.line === position);
        const isEditorOpen = editor !== null && editor.path === path && editor.line === position;
        return (
          <div key={index} className={`diff-line-row diff-line-row--${entry.type}`}>
            <div className="diff-line-row__main">
              <span className="diff-line-row__gutter">
                {commentable ? (
                  <button
                    type="button"
                    className="diff-line__add-comment"
                    aria-label="Add comment"
                    onClick={() => onAddComment(path, position)}
                  >
                    +
                  </button>
                ) : null}
              </span>
              <span className={`diff-lines__line diff-lines__line--${entry.type}`}>
                {entry.type === "add" ? "+" : entry.type === "del" ? "-" : " "} {entry.line}
              </span>
            </div>
            {lineComments.length > 0 ? (
              <div className="diff-line-row__comments">
                {lineComments.map((comment) => (
                  <CommentBlock key={comment.id} comment={comment} />
                ))}
              </div>
            ) : null}
            {isEditorOpen && editor ? (
              <div className="diff-line-row__editor">
                <CommentEditor
                  value={editor.body}
                  error={editor.error}
                  busy={editor.busy}
                  onChange={onChangeBody}
                  onSubmit={() => onSubmit(path, position)}
                  onStartReview={() => onStartReview(path, position)}
                />
              </div>
            ) : null}
          </div>
        );
      })}
      {comments
        .filter((comment) => comment.line > lines.length)
        .map((comment) => (
          <div className="diff-line-row diff-line-row--outdated" key={comment.id}>
            <div className="diff-line-row__main">
              <span className="diff-line-row__gutter" />
              <span className="diff-lines__line diff-lines__line--outdated">
                Original line {comment.line}
              </span>
            </div>
            <div className="diff-line-row__comments">
              <CommentBlock comment={comment} />
            </div>
          </div>
        ))}
    </div>
  );
}

function DiffFileList({
  files,
  base,
  compare,
  hrefFor,
}: {
  files: FileDiff[];
  base: string;
  compare: string;
  hrefFor: (path: string) => string;
}) {
  return (
    <ul className="diff-files">
      {files.map((file) => (
        <li key={file.path} className="diff-files__item">
          <a href={hrefFor(file.path)} className="diff-files__path">
            {file.path}
          </a>
          <span className="diff-files__counts">
            +{file.additions} −{file.deletions}
          </span>
          <span className="diff-files__revisions">
            {base} → {compare}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DiffView({
  repository,
  base,
  compare,
  files,
  totalAdditions,
  totalDeletions,
  hrefFor,
  showAll = true,
  canComment = false,
  inlineComments = [],
  onPublishComment,
  onStartReview,
}: {
  repository: { owner: string; name: string };
  base: string;
  compare: string;
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
  hrefFor: (path: string) => string;
  showAll?: boolean;
  canComment?: boolean;
  inlineComments?: InlineDiffComment[];
  onPublishComment?: (path: string, line: number, body: string) => Promise<CommentSubmitResult>;
  onStartReview?: (path: string, line: number, body: string) => Promise<CommentSubmitResult>;
}) {
  const [editor, setEditor] = useState<DiffEditorState | null>(null);

  const openEditor = (path: string, line: number) => {
    setEditor({ path, line, body: "", error: null, busy: false });
  };

  const submit = async (
    mode: "publish" | "review",
    path: string,
    line: number,
    body: string,
  ) => {
    if (!editor || editor.busy) return;
    setEditor({ ...editor, busy: true, error: null });
    const handler = mode === "publish" ? onPublishComment : onStartReview;
    const result =
      (await handler?.(path, line, body)) ?? { ok: false, error: "Comments are not available here" };
    if (result.ok) {
      setEditor(null);
      return;
    }
    setEditor({
      path,
      line,
      body,
      busy: false,
      error: result.error ?? "The comment could not be published",
    });
  };

  return (
    <section className="diff-view">
      <div className="diff-view__summary">
        <h2>Changed files</h2>
        <p className="diff-view__counts" role="status">
          {totalAdditions} additions, {totalDeletions} deletions
        </p>
      </div>
      <DiffFileList files={files} base={base} compare={compare} hrefFor={hrefFor} />
      {files.length === 0 ? (
        <p className="diff-view__empty">No changed files.</p>
      ) : (
        <div className="diff-view__bodies">
          {(showAll ? files : files.slice(0, 1)).map((file) => (
            <article key={file.path} className="diff-file">
              <h3 className="diff-file__name">{file.path}</h3>
              <DiffLines
                lines={file.lines}
                path={file.path}
                canComment={canComment}
                comments={inlineComments.filter((comment) => comment.path === file.path)}
                editor={editor}
                onAddComment={openEditor}
                onChangeBody={(body) =>
                  setEditor((previous) => (previous ? { ...previous, body } : previous))
                }
                onSubmit={(path, line) => {
                  void submit("publish", path, line, editor?.body.trim() ?? "");
                }}
                onStartReview={(path, line) => {
                  void submit("review", path, line, editor?.body.trim() ?? "");
                }}
              />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
