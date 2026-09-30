import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { repositoryBlobHref } from "../lib/repository-routes";
import {
  fetchRepositoryFile,
  fetchRepositoryOverview,
  repositoryTitle,
  type RepositoryContext,
} from "../lib/repositories-api";
import { FileEditorForm } from "../repository/FileEditorForm";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { useRepositoryResource } from "../repository/useRepositoryResource";

export interface RepositoryFileEditorPageProps {
  owner: string;
  name: string;
  branch: string;
  /** "" creates a new file; an existing path opens its stored content. */
  path: string;
}

interface EditorContext {
  repository: RepositoryContext;
  path: string;
  content: string;
}

/**
 * The file editor (REQ-4-4): opened from `Edit` on a file page or from
 * `Add file` → `Create new file` on the Code page. It stores the edit as one new
 * commit on the current branch and then opens the file view of the saved
 * content, so the branch head, the file list and the history all describe the
 * same new revision.
 */
export function RepositoryFileEditorPage({
  owner,
  name,
  branch,
  path,
}: RepositoryFileEditorPageProps) {
  const editing = path !== "";
  const state = useRepositoryResource<EditorContext>(async () => {
    if (!editing) {
      const repository = await fetchRepositoryOverview(owner, name, branch);
      return { repository, path: "", content: "" };
    }
    const payload = await fetchRepositoryFile(owner, name, branch, path);
    return {
      repository: payload.repository,
      path: payload.file.path,
      content: payload.file.content,
    };
  }, [owner, name, branch, path]);

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading the file editor…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Editor unavailable</h1>
        <p role="alert">The file editor could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }
  if (state.status === "missing") return <NotFoundPage hint={repositoryAccessHint()} />;

  const { repository, content } = state.value;
  const canWrite =
    repository.permissions?.role === "write" ||
    repository.permissions?.role === "maintain" ||
    repository.permissions?.role === "admin";

  return (
    <main>
      <RepositoryChrome
        owner={owner}
        name={name}
        title={repositoryTitle(repository)}
        visibility={repository.visibility}
        description={repository.description}
        activeEntry="Code"
      />
      <p className="repository-branch">
        Branch: <span className="repository-branch__name">{branch}</span>
      </p>
      <section className="file-editor" aria-labelledby="file-editor-heading">
        <h2 id="file-editor-heading">{editing ? `Edit ${path}` : "Create new file"}</h2>
        {canWrite ? (
          <FileEditorForm
            owner={owner}
            name={name}
            branch={branch}
            initialPath={editing ? state.value.path : ""}
            initialContent={content}
            onCommitted={(savedPath, savedBranch) => {
              window.location.hash = repositoryBlobHref(owner, name, savedBranch, savedPath);
            }}
          />
        ) : (
          <p role="alert" className="form-message form-message--error">
            You need write permission to edit files in this repository.
          </p>
        )}
      </section>
    </main>
  );
}
