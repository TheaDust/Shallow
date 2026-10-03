import { useEffect, useState, type FormEvent } from "react";

import { apiFieldErrors } from "../lib/api";
import {
  createFork,
  fetchMyOrganizations,
  type RepositoryOwner,
  type RepositorySummary,
} from "../lib/organization-api";
import { buildOwnerOptions, type OwnerOption } from "../lib/repository-owners";
import { apiErrorMessage, useAsyncData } from "../lib/use-async-data";
import { Button, Combobox, Dialog, FormField } from "../ui";

type Visibility = "public" | "private";

export interface ForkSource {
  ownerName: string;
  repositoryName: string;
  name: string;
  visibility: Visibility;
}

export interface RepositoryForkDialogProps {
  source: ForkSource;
  /** The signed-in account whose personal namespace is the default target. */
  username: string;
  onOpenChange(open: boolean): void;
  onForked(result: { owner: RepositoryOwner; repository: RepositorySummary }): void;
}

function encodeOwner(owner: OwnerOption): string {
  return `${owner.type}:${owner.name}`;
}

/**
 * The fork form behind the source overview's “Fork” button. It defaults to the
 * signed-in user's personal namespace, the source name and an allowed
 * visibility, so only the name must be edited to submit. A rejected attempt
 * keeps the form (and its reason) instead of opening a fork.
 */
export function RepositoryForkDialog({ source, username, onOpenChange, onForked }: RepositoryForkDialogProps) {
  const organizations = useAsyncData(fetchMyOrganizations, [username]);
  const owners = organizations.data ? buildOwnerOptions(username, organizations.data) : [];
  const [ownerValue, setOwnerValue] = useState("");
  const [name, setName] = useState(source.name);
  const [visibility, setVisibility] = useState<Visibility>(source.visibility);
  const [errors, setErrors] = useState<{ name?: string; owner?: string; visibility?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sourceIsPrivate = source.visibility === "private";

  useEffect(() => {
    if (ownerValue || owners.length === 0) return;
    const personal = owners.find((owner) => owner.type === "user") ?? owners[0];
    setOwnerValue(encodeOwner(personal));
  }, [owners, ownerValue]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const [ownerType, ownerName] = ownerValue.split(":");
    try {
      const result = await createFork(source.ownerName, source.repositoryName, {
        ownerType: ownerType === "user" ? "user" : "organization",
        ownerName,
        name,
        visibility,
      });
      onForked(result);
    } catch (caught) {
      const fieldErrors = apiFieldErrors(caught);
      setErrors({ name: fieldErrors.name, owner: fieldErrors.owner, visibility: fieldErrors.visibility });
      if (Object.keys(fieldErrors).length === 0) setFormError(apiErrorMessage(caught, "Unable to create the fork."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="Fork repository" onOpenChange={onOpenChange}>
      <form className="auth-form" noValidate onSubmit={handleSubmit}>
        <Combobox
          id="fork-owner"
          label="Owner"
          value={ownerValue}
          options={owners.map((owner) => ({ value: encodeOwner(owner), label: owner.displayName }))}
          onChange={(event) => setOwnerValue(event.target.value)}
        />
        <FormField id="fork-name" label="Repository name" error={errors.name}>
          <input
            id="fork-name"
            name="name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <fieldset className="visibility-choice">
          <legend>Visibility</legend>
          <label className="visibility-choice__option">
            <input
              type="radio"
              name="fork-visibility"
              value="public"
              disabled={sourceIsPrivate}
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
            />
            Public
          </label>
          <label className="visibility-choice__option">
            <input
              type="radio"
              name="fork-visibility"
              value="private"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
            />
            Private
          </label>
        </fieldset>
        {errors.owner ? (
          <p className="form-error" role="alert">
            {errors.owner}
          </p>
        ) : null}
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !ownerValue}>
            Create fork
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
