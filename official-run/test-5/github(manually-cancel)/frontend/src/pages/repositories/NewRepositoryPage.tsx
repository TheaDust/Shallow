import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { navigate } from "../../lib/hash-route";
import { repositoryHash } from "../../org/org-api";
import { useAsyncData } from "../../org/use-async-data";
import { createRepository, fetchRepositoryOwners } from "../../repo/repo-api";
import type { RepositoryFormErrors, RepositoryOwnerOption, RepositoryVisibility } from "../../repo/types";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";
import { useSession } from "../../session/SessionProvider";
import { AuthenticationRequired, BusyMain } from "../common";

function ownerKey(owner: RepositoryOwnerOption): string {
  return `${owner.type}:${owner.name}`;
}

function parseOwnerKey(key: string): { ownerType: "account" | "organization"; ownerName: string } {
  const [type, ...rest] = key.split(":");
  return {
    ownerType: type === "organization" ? "organization" : "account",
    ownerName: rest.join(":"),
  };
}

/**
 * REQ-3-2-1: the repository-creation page opened by “New repository”. The personal
 * namespace is selected by default, so the form can be submitted without touching
 * the owner; the server validates the namespace permission, the name uniqueness and
 * the options, and reports a rejected submit beside the matching field without
 * leaving the form.
 */
export function NewRepositoryPage() {
  const { status, account } = useSession();
  const username = account?.username ?? null;
  const owners = useAsyncData(
    () => (username ? fetchRepositoryOwners() : Promise.resolve([])),
    [username],
  );
  const [selectedOwner, setSelectedOwner] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<RepositoryVisibility>("public");
  const [initialize, setInitialize] = useState(false);
  const [errors, setErrors] = useState<RepositoryFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const options = owners.data ?? [];
  const loadingOwners = owners.status === "loading";

  // The personal namespace is the default owner; the account keeps its choice when
  // the options are reloaded.
  useEffect(() => {
    if (selectedOwner || options.length === 0) return;
    const personal = options.find((owner) => owner.type === "account") ?? options[0];
    setSelectedOwner(ownerKey(personal));
  }, [options, selectedOwner]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const owner = parseOwnerKey(selectedOwner);
      const result = await createRepository({
        ...owner,
        name,
        description,
        visibility,
        initialize,
      });
      if (result.ok) {
        setErrors({});
        navigate(repositoryHash(result.repository.ownerName, result.repository.name));
        return;
      }
      setErrors(result.errors);
    } catch {
      setFormError("Unable to create the repository. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "loading") return <BusyMain />;
  if (!account) return <AuthenticationRequired />;

  return (
    <main>
      <h1>New repository</h1>
      <form className="new-repository" onSubmit={onSubmit} noValidate>
        <FormField id="repository-owner" label="Owner" error={errors.owner}>
          <select
            id="repository-owner"
            name="owner"
            value={selectedOwner}
            disabled={loadingOwners || submitting}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => setSelectedOwner(event.target.value)}
          >
            {options.map((owner) => (
              <option key={ownerKey(owner)} value={ownerKey(owner)}>
                {owner.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="repository-name" label="Repository name" error={errors.name}>
          <input
            id="repository-name"
            name="name"
            type="text"
            value={name}
            disabled={submitting}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
          />
        </FormField>
        <FormField id="repository-description" label="Description" error={errors.description}>
          <textarea
            id="repository-description"
            name="description"
            rows={3}
            value={description}
            disabled={submitting}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDescription(event.target.value)}
          />
        </FormField>
        <fieldset className="new-repository__visibility">
          <legend>Visibility</legend>
          <p className="new-repository__choice">
            <input
              id="repository-visibility-public"
              name="visibility"
              type="radio"
              value="public"
              checked={visibility === "public"}
              disabled={submitting}
              onChange={() => setVisibility("public")}
            />
            <label htmlFor="repository-visibility-public">Public</label>
          </p>
          <p className="new-repository__choice">
            <input
              id="repository-visibility-private"
              name="visibility"
              type="radio"
              value="private"
              checked={visibility === "private"}
              disabled={submitting}
              onChange={() => setVisibility("private")}
            />
            <label htmlFor="repository-visibility-private">Private</label>
          </p>
        </fieldset>
        <p className="new-repository__choice">
          <input
            id="repository-initialize"
            name="initialize"
            type="checkbox"
            checked={initialize}
            disabled={submitting}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setInitialize(event.target.checked)}
          />
          <label htmlFor="repository-initialize">Add a README file</label>
        </p>
        {errors.visibility ? (
          <p className="auth-form__error" role="alert">
            {errors.visibility}
          </p>
        ) : null}
        {formError ? (
          <p className="auth-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={submitting || loadingOwners}>
          Create repository
        </Button>
      </form>
    </main>
  );
}
