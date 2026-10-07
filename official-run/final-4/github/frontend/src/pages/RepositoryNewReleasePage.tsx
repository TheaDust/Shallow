import { useEffect, useState } from "react";

import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { navigate } from "../lib/hash-route";
import { createRepositoryRelease, fetchRepositoryBranches } from "../lib/org-api";
import { repositoryReleasesHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { FormField } from "../ui/FormField";

/**
 * "New release" form of one repository (REQ-4-5). The visible `Tag name`,
 * `Release title`, `Description` and `Target branch` fields publish one release
 * on an existing branch through `Publish release`. The tag is unique inside the
 * repository: a duplicate tag is reported as `Tag already exists` in the form
 * and creates no second release, so the form stays open for correction.
 */
export function RepositoryNewReleasePage({ owner, name }: { owner: string; name: string }) {
  const branches = useAsyncData(() => fetchRepositoryBranches(owner, name), [owner, name]);
  const [tag, setTag] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [branch, setBranch] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const branchNames = branches.data?.branches.map((entry) => entry.name) ?? [];
  const defaultBranch = branches.data?.defaultBranch ?? "";
  const canPublish = branches.data?.canWrite ?? false;

  // The target branch starts on the repository default branch, which is the
  // branch every release repository is read by.
  useEffect(() => {
    setBranch((current) => current || defaultBranch);
  }, [defaultBranch]);

  const submit = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setTagError(null);
    setBranchError(null);
    const result = await createRepositoryRelease(owner, name, {
      tag,
      title,
      description,
      branch: branch || defaultBranch,
    });
    setBusy(false);
    if (!result.ok) {
      // A duplicate tag is the stored-message case the requirement names; the
      // message is shown once, on the field it belongs to.
      setTagError(result.fieldErrors.tag ?? null);
      setBranchError(result.fieldErrors.branch ?? null);
      if (!result.fieldErrors.tag && !result.fieldErrors.branch) setTagError(result.message);
      return;
    }
    navigate(
      `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases/${encodeURIComponent(
        result.value.tag,
      )}`,
    );
  };

  return (
    <main className="page">
      <section className="page__body repository-new-release">
        {branches.data ? <RepositoryBreadcrumb repository={branches.data.repository} /> : null}
        <h1 className="repository-new-release__title">New release</h1>
        {branches.status === "loading" && !branches.data ? (
          <LoadingNote label="Loading branches…" />
        ) : null}
        {branches.status === "error" && branches.error ? (
          <ErrorHeading error={branches.error} />
        ) : null}
        {branches.data ? (
          <form className="repository-new-release__form" onSubmit={(event) => void submit(event)}>
            <FormField id="release-tag" label="Tag name" error={tagError ?? undefined}>
              <input
                id="release-tag"
                name="tag"
                type="text"
                value={tag}
                onChange={(event) => {
                  setTag(event.target.value);
                  setTagError(null);
                }}
              />
            </FormField>
            <FormField id="release-title" label="Release title">
              <input
                id="release-title"
                name="title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </FormField>
            <FormField id="release-description" label="Description">
              <textarea
                id="release-description"
                name="description"
                rows={5}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormField>
            <FormField id="release-branch" label="Target branch" error={branchError ?? undefined}>
              <Combobox
                id="release-branch"
                label="Target branch"
                labelHidden
                options={branchNames.map((branchName) => ({ value: branchName, label: branchName }))}
                value={branch || defaultBranch}
                onChange={(event) => {
                  setBranch(event.currentTarget.value);
                  setBranchError(null);
                }}
              />
            </FormField>
            <div className="repository-new-release__actions">
              <Button type="submit" variant="primary" disabled={busy || !canPublish}>
                Publish release
              </Button>
              <a className="ui-button" href={repositoryReleasesHash(owner, name)}>
                Cancel
              </a>
            </div>
          </form>
        ) : null}
      </section>
    </main>
  );
}
