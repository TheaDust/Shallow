import { useEffect, useState, type FormEvent } from "react";

import { navigate } from "../../lib/hash-route";
import {
  listMyOrganizations,
  type OrganizationMembership,
  type RepositoryVisibility,
} from "../../lib/organizations-api";
import { repositoryPath } from "../../lib/repository-code-api";
import { createRepository, fieldErrorsOf } from "../../lib/repositories-api";
import { useDocumentTitle } from "../../lib/document-title";
import { useAccountSession } from "../account/AccountSession";
import { ProtectedPage } from "../account/ProtectedPage";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";

/**
 * The form opened by the workspace link `New repository`. The signed-in user's
 * personal namespace is selected by default, so the form can be submitted for
 * a personal repository without touching the owner; the visibility radios,
 * the README checkbox and the description keep their defaults too. Every rule
 * (name, duplicate, namespace permission) is validated by the server, whose
 * per-field reasons are rendered here while the form stays open.
 */
export function NewRepositoryPage() {
  const { status: sessionStatus, account } = useAccountSession();
  const [organizations, setOrganizations] = useState<OrganizationMembership[]>([]);
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<RepositoryVisibility>("public");
  const [initializeReadme, setInitializeReadme] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useDocumentTitle("New repository");

  useEffect(() => {
    if (!account) return;
    setOwner((current) => (current.length > 0 ? current : account.username));
  }, [account]);

  useEffect(() => {
    if (sessionStatus !== "ready" || !account) return;
    let cancelled = false;
    listMyOrganizations()
      .then((list) => {
        // Only a namespace the account may create repositories in is offered.
        if (!cancelled) setOrganizations(list.filter((entry) => entry.role === "owner"));
      })
      .catch(() => {
        if (!cancelled) setOrganizations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, account]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const repository = await createRepository({
        owner,
        name,
        description,
        visibility,
        initializeReadme,
      });
      navigate(repositoryPath(repository.owner, repository.name));
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setFieldErrors(errors);
      if (Object.keys(errors).length === 0) setFormError("Repository creation failed");
    } finally {
      setSubmitting(false);
    }
  }

  const ownerOptions = [
    ...(account
      ? [{ value: account.username, label: account.username, personal: true }]
      : []),
    ...organizations.map((organization) => ({
      value: organization.name,
      label: organization.name,
      personal: false,
    })),
  ];

  return (
    <ProtectedPage title="New repository">
      {account ? (
        <form className="new-repository-form" onSubmit={handleSubmit} noValidate>
          <FormField
            id="repository-owner"
            label="Owner"
            description="The personal namespace is selected by default."
            error={fieldErrors.owner}
          >
            <select
              id="repository-owner"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
            >
              {ownerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="repository-name"
            label="Repository name"
            error={fieldErrors.name}
          >
            <input
              id="repository-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField
            id="repository-description"
            label="Description"
            error={fieldErrors.description}
          >
            <textarea
              id="repository-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
          <fieldset className="ui-field">
            <legend>Visibility</legend>
            <label htmlFor="repository-visibility-public">
              <input
                id="repository-visibility-public"
                type="radio"
                name="repository-visibility"
                value="public"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />
              Public
            </label>
            <label htmlFor="repository-visibility-private">
              <input
                id="repository-visibility-private"
                type="radio"
                name="repository-visibility"
                value="private"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
              />
              Private
            </label>
            {fieldErrors.visibility ? (
              <p className="ui-field__error" role="alert">
                {fieldErrors.visibility}
              </p>
            ) : null}
          </fieldset>
          <div className="ui-field">
            <label htmlFor="repository-initialize-readme">
              <input
                id="repository-initialize-readme"
                type="checkbox"
                checked={initializeReadme}
                onChange={(event) => setInitializeReadme(event.target.checked)}
              />
              Add a README file
            </label>
          </div>
          {formError ? (
            <p className="ui-field__error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="new-repository-form__actions">
            <Button type="submit" variant="primary" disabled={submitting}>
              Create repository
            </Button>
            {submitting ? <span role="status">Creating…</span> : null}
          </div>
        </form>
      ) : null}
    </ProtectedPage>
  );
}
