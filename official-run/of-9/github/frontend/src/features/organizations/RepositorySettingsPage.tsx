import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { Button, Dialog, FormField } from "../../ui";
import { getRepository, setRepositoryVisibility, type RepositoryOverview, type Visibility } from "./api";
import { AccessDenied } from "./AccessDenied";
import { RepositorySettingsNav } from "./RepositorySettingsNav";

export function RepositorySettingsPage({ owner, name }: { owner: string; name: string }) {
  const [repository, setRepository] = useState<RepositoryOverview | null>(null);
  const [denied, setDenied] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRepository(owner, name)
      .then((repo) => {
        if (cancelled) return;
        setRepository(repo);
        if (repo.myRole !== "admin") setDenied(true);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  if (denied) return <AccessDenied />;
  if (!repository) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const openDialog = () => {
    setVisibility(repository.visibility);
    setConfirmName("");
    setError(null);
    setDialogOpen(true);
  };

  const confirmVisibility = async () => {
    if (busy || !repository) return;
    const typed = confirmName.trim();
    if (typed && typed !== `${owner}/${name}` && typed !== name) {
      setError("Repository name does not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await setRepositoryVisibility(owner, name, visibility);
      setRepository(updated);
      setDialogOpen(false);
      setNotice(
        visibility === "public"
          ? "Repository visibility changed to Public"
          : "Repository visibility changed to Private",
      );
    } catch (requestError: unknown) {
      setError(
        requestError instanceof ApiError ? requestError.message : "Unable to change visibility",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="repository-settings">
      <header className="repository-settings__header">
        <h1>Settings</h1>
        <p>
          {owner}/{name}
        </p>
      </header>
      <RepositorySettingsNav owner={owner} name={name} tab="general" />

      {notice ? (
        <p role="status" className="repository-settings__notice">
          {notice}
        </p>
      ) : null}

      <section className="danger-zone">
        <h2>Danger Zone</h2>
        <p className="danger-zone__text">
          Change the visibility of this repository. This repository is currently{" "}
          {repository.visibility === "public" ? "Public" : "Private"}.
        </p>
        <Button variant="danger" onClick={openDialog}>
          Change visibility
        </Button>
      </section>

      <Dialog
        open={dialogOpen}
        title="Change repository visibility"
        onOpenChange={setDialogOpen}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirmVisibility()}>
              Confirm visibility
            </Button>
          </>
        }
      >
        <fieldset className="visibility-fieldset">
          <legend>Visibility</legend>
          <label>
            <input
              type="radio"
              name="visibility"
              value="public"
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
            />
            Public
          </label>
          <label>
            <input
              type="radio"
              name="visibility"
              value="private"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
            />
            Private
          </label>
        </fieldset>
        <FormField
          id="visibility-confirm-name"
          label="Repository name"
          description="Enter the full repository name to confirm the change."
          error={error ?? undefined}
        >
          <input
            id="visibility-confirm-name"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
          />
        </FormField>
      </Dialog>
    </section>
  );
}
