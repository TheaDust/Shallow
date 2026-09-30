import { useEffect, useState, type FormEvent } from "react";

import { SignInRequired } from "../auth/SignInRequired";
import { useAuth } from "../auth/AuthProvider";
import { apiErrorMessage, readErrorFields } from "../lib/api";
import { navigate } from "../lib/hash-route";
import {
  createRepository,
  fetchCreatableNamespaces,
  type NamespaceOption,
  type RepositoryVisibility,
} from "../lib/repositories-api";
import { repositoryOverviewPath } from "../lib/repository-routes";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { VisibilityChoice } from "../repository/VisibilityChoice";

/**
 * The repository-creation form opened by the workspace entry "New repository"
 * (REQ-3-2-1). Owner, visibility and the README option have working defaults, so
 * submitting an empty or duplicated name is possible without further input and
 * is answered on the form itself.
 */
export function NewRepositoryPage() {
  const { status, account } = useAuth();

  const [namespaces, setNamespaces] = useState<NamespaceOption[]>([]);
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<RepositoryVisibility>("public");
  const [initialize, setInitialize] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!account) return;
    setOwner((current) => current || account.username);
    let active = true;
    fetchCreatableNamespaces()
      .then((options) => {
        if (!active || options.length === 0) return;
        setNamespaces(options);
        setOwner((current) => current || options[0].login);
      })
      .catch(() => {
        // The personal namespace stays selectable when the list is unavailable.
      });
    return () => {
      active = false;
    };
  }, [account]);

  if (status === "loading") {
    return (
      <main aria-busy="true">
        <h1>New repository</h1>
        <p role="status">Loading your session…</p>
      </main>
    );
  }

  if (!account) {
    return (
      <main>
        <h1>New repository</h1>
        <SignInRequired />
      </main>
    );
  }

  const options: NamespaceOption[] =
    namespaces.length > 0 ? namespaces : [{ type: "user", login: account.username }];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNameError(null);
    setError(null);
    try {
      const repository = await createRepository({
        owner,
        name: name.trim(),
        description,
        visibility,
        initializeWithReadme: initialize,
      });
      navigate(repositoryOverviewPath(repository.owner.login, repository.name));
    } catch (caught) {
      const fields = readErrorFields(caught);
      setNameError(fields.name ?? null);
      if (fields.visibility) setError(fields.visibility);
      else if (!fields.name) setError(apiErrorMessage(caught, "The repository could not be created."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>New repository</h1>
      <form className="repository-form" aria-label="New repository" onSubmit={submit}>
        <FormField id="repository-owner" label="Owner">
          <select id="repository-owner" value={owner} onChange={(event) => setOwner(event.target.value)}>
            {options.map((option) => (
              <option key={`${option.type}:${option.login}`} value={option.login}>
                {option.login}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="repository-name" label="Repository name" error={nameError ?? undefined}>
          <input
            id="repository-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField id="repository-description" label="Description">
          <textarea
            id="repository-description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <VisibilityChoice
          groupName="repository-visibility"
          legend="Visibility"
          value={visibility}
          onChange={setVisibility}
        />
        <div className="repository-form__checkbox">
          <label>
            <input
              type="checkbox"
              checked={initialize}
              onChange={(event) => setInitialize(event.target.checked)}
            />
            Add a README file
          </label>
        </div>
        {error ? (
          <p role="alert" className="form-message form-message--error">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={busy}>
          Create repository
        </Button>
      </form>
    </main>
  );
}
