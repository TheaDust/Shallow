import { useEffect, useState, type FormEvent } from "react";

import { errorMessageOf, fieldErrorsOf } from "../auth/api";
import { useSession } from "../auth/SessionContext";
import { navigate } from "../lib/hash-route";
import { createRepository, fetchOwnerNamespaces } from "../repositories/api";
import { repositoryPath } from "../repositories/routes";
import type { RepositoryNamespace, RepositoryOwnerKind } from "../repositories/types";
import type { RepositoryVisibility } from "../organizations/types";
import { Button, FormField, fieldDescriptionIds } from "../ui";

interface RepositoryFormErrors {
  name?: string;
  owner?: string;
}

const FALLBACK_ERROR = "We could not create the repository. Try again.";

function namespaceValue(namespace: RepositoryNamespace): string {
  return `${namespace.kind}:${namespace.id}`;
}

function namespaceOf(namespaces: readonly RepositoryNamespace[], value: string): RepositoryNamespace | null {
  return namespaces.find((namespace) => namespaceValue(namespace) === value) ?? null;
}

/**
 * Repository-creation form behind the workspace "New repository" link. The
 * owner namespace defaults to the personal namespace of the signed-in account,
 * so a submission is possible without changing the owner; the server owns the
 * name rules, the uniqueness check and the namespace permission, and a rejected
 * submission stays on the form with the returned reasons.
 */
export function NewRepositoryPage() {
  const { account } = useSession();
  const [namespaces, setNamespaces] = useState<RepositoryNamespace[] | null>(null);
  const [ownerValue, setOwnerValue] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<RepositoryVisibility>("public");
  const [initialize, setInitialize] = useState(false);
  const [errors, setErrors] = useState<RepositoryFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fallback: RepositoryNamespace[] = account
      ? [{ kind: "account", id: account.username, label: account.username }]
      : [];
    setNamespaces(null);
    if (!account) return () => { cancelled = true; };
    fetchOwnerNamespaces(account.username)
      .then((next) => {
        if (cancelled) return;
        setNamespaces(next);
        setOwnerValue((current) => (current.length > 0 ? current : namespaceValue(next[0])));
      })
      .catch(() => {
        if (cancelled) return;
        setNamespaces(fallback);
        setOwnerValue((current) => (current.length > 0 ? current : namespaceValue(fallback[0])));
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const target = namespaceOf(namespaces ?? [], ownerValue);
    if (!target) {
      setErrors({ owner: "Select an owner namespace" });
      return;
    }
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const repository = await createRepository({
        ownerKind: target.kind as RepositoryOwnerKind,
        owner: target.id,
        name,
        description,
        visibility,
        initializeWithReadme: initialize,
      });
      navigate(repositoryPath(target.kind, target.id, repository.name));
    } catch (failure) {
      const fieldErrors = fieldErrorsOf(failure);
      if (fieldErrors) setErrors({ name: fieldErrors.name, owner: fieldErrors.owner });
      else setFormError(errorMessageOf(failure) ?? FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page page--narrow">
      <h1>New repository</h1>
      <p className="page__lead">
        A repository belongs to your personal namespace or to an organization you own. Its name only
        has to be unique inside that namespace.
      </p>
      <form className="app-form" aria-label="New repository" noValidate onSubmit={handleSubmit}>
        <FormField
          id="repository-owner"
          label="Owner"
          error={errors.owner}
          description="Your personal namespace is selected by default."
        >
          <select
            id="repository-owner"
            name="owner"
            value={ownerValue}
            aria-describedby={fieldDescriptionIds("repository-owner", {
              description: true,
              error: Boolean(errors.owner),
            })}
            onChange={(event) => setOwnerValue(event.target.value)}
          >
            {(namespaces ?? []).map((namespace) => (
              <option key={namespaceValue(namespace)} value={namespaceValue(namespace)}>
                {namespace.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          id="repository-name"
          label="Repository name"
          error={errors.name}
          description="Letters, digits, dots, dashes and underscores."
        >
          <input
            id="repository-name"
            name="name"
            type="text"
            autoComplete="off"
            value={name}
            aria-describedby={fieldDescriptionIds("repository-name", {
              description: true,
              error: Boolean(errors.name),
            })}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField id="repository-description" label="Description">
          <textarea
            id="repository-description"
            name="description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <fieldset className="ui-field">
          <legend>Visibility</legend>
          <div className="app-form__choices">
            <label className="app-form__choice">
              <input
                type="radio"
                name="visibility"
                value="public"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />
              Public
            </label>
            <label className="app-form__choice">
              <input
                type="radio"
                name="visibility"
                value="private"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
              />
              Private
            </label>
          </div>
        </fieldset>
        <FormField id="repository-initialize" label="Add a README file">
          <input
            id="repository-initialize"
            name="initializeWithReadme"
            type="checkbox"
            checked={initialize}
            onChange={(event) => setInitialize(event.target.checked)}
          />
        </FormField>
        {formError ? (
          <p className="app-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="app-form__actions">
          <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
            Create repository
          </Button>
        </div>
      </form>
    </section>
  );
}
