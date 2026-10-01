import { useState } from "react";

import { Button, Dialog, FormField } from "../ui";
import { navigate } from "../lib/hash-route";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { RepositoryNav } from "../features/repositories/RepositoryNav";
import { changeRepositoryVisibility } from "../features/repositories/repository-api";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryGeneralSettingsPageProps {
  owner: string;
  name: string;
}

const CONFIRMATION_ID = "repository-visibility-confirmation";

/**
 * General settings with the Danger Zone (REQ-3-4).
 *
 * The "Change visibility" action is only rendered for a repository Admin — a
 * non-Admin collaborator never sees it, and the server refuses the write for
 * anyone else as well. The confirmation flow offers the "Public" (or "Private")
 * radio plus "Confirm visibility"; the optional confirmation text needs no
 * retyping, but a typed value has to spell the repository name.
 */
export function RepositoryGeneralSettingsPage({ owner, name }: RepositoryGeneralSettingsPageProps) {
  const { state, repository } = useRepositoryOverview(owner, name);
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!repository || state !== "ready") return <RepositoryLoadState state={state} />;

  const openDialog = () => {
    setVisibility(repository.visibility === "private" ? "private" : "public");
    setConfirmation("");
    setErrors({});
    setMessage(null);
    setOpen(true);
  };

  const confirm = async () => {
    setSubmitting(true);
    setErrors({});
    setMessage(null);
    const result = await changeRepositoryVisibility(repository.owner, repository.name, {
      visibility,
      confirmation,
    });
    setSubmitting(false);
    if (!result.ok) {
      setErrors(result.errors);
      // A field error is announced next to its input; only an error without a
      // field renders the dialog-level alert, so one reason is shown.
      setMessage(result.errors.confirmation || result.errors.visibility ? null : result.message);
      return;
    }
    setOpen(false);
    navigate(`/${result.data.owner}/${result.data.name}`);
  };

  return (
    <main className="repository-general-settings-page">
      <h1>General</h1>
      <p className="repository-general-settings-page__repository">
        <a href={`#/${repository.owner}/${repository.name}`}>{repository.fullName}</a>
      </p>
      <RepositoryNav owner={repository.owner} name={repository.name} active="settings" />
      <p className="repository-general-settings-page__description">
        {repository.description || "No description"}
      </p>

      <section className="settings-danger-zone" aria-label="Danger Zone">
        <h2>Danger Zone</h2>
        <p className="settings-danger-zone__state">
          {`This repository is ${repository.visibility === "public" ? "Public" : "Private"}. Changing the visibility changes who can read it and how it appears in search and repository lists.`}
        </p>
        {repository.canChangeVisibility ? (
          <Button variant="danger" onClick={openDialog}>
            Change visibility
          </Button>
        ) : (
          <p className="settings-danger-zone__restricted">
            Only a repository Admin can change the visibility of this repository.
          </p>
        )}
      </section>

      <Dialog
        open={open}
        title="Change visibility"
        onOpenChange={setOpen}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={submitting} onClick={confirm}>
              Confirm visibility
            </Button>
          </>
        }
      >
        <fieldset className="repository-form__group">
          <legend>Visibility</legend>
          <label className="repository-form__choice">
            <input
              type="radio"
              name="visibility"
              value="public"
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
            />{" "}
            Public
          </label>
          <label className="repository-form__choice">
            <input
              type="radio"
              name="visibility"
              value="private"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
            />{" "}
            Private
          </label>
        </fieldset>
        <FormField
          id={CONFIRMATION_ID}
          label="Repository name"
          description="Optional: type the repository name to confirm the change."
          error={errors.confirmation}
        >
          <input
            id={CONFIRMATION_ID}
            name="confirmation"
            type="text"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </FormField>
        {message ? (
          <p className="repository-form__error" role="alert">
            {message}
          </p>
        ) : null}
      </Dialog>
    </main>
  );
}
