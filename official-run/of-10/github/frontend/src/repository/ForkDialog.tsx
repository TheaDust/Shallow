import { useEffect, useRef, useState, type FormEvent } from "react";

import { useAuth } from "../auth/AuthProvider";
import { apiErrorMessage, readErrorFields } from "../lib/api";
import { navigate } from "../lib/hash-route";
import {
  createForkRepository,
  fetchCreatableNamespaces,
  fetchForkDefaults,
  type NamespaceOption,
  type RepositoryVisibility,
} from "../lib/repositories-api";
import { repositoryOverviewPath } from "../lib/repository-routes";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { VisibilityChoice } from "./VisibilityChoice";

export interface ForkDialogProps {
  owner: string;
  name: string;
  sourceVisibility: RepositoryVisibility;
}

/**
 * Fork entry of a repository overview (REQ-3-2-2). The form defaults to the
 * signed-in personal namespace and an allowed visibility, so submitting only
 * requires the repository name to be adjusted when the suggested one is taken.
 */
export function ForkDialog({ owner, name, sourceVisibility }: ForkDialogProps) {
  const { account } = useAuth();
  const [open, setOpen] = useState(false);
  const [namespaces, setNamespaces] = useState<NamespaceOption[]>([]);
  const [target, setTarget] = useState("");
  const [repositoryName, setRepositoryName] = useState("");
  const [visibility, setVisibility] = useState<RepositoryVisibility>("public");
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [optionsPending, setOptionsPending] = useState(false);
  const editedName = useRef(false);

  const privateSource = sourceVisibility === "private";

  useEffect(() => {
    let active = true;
    fetchCreatableNamespaces()
      .then((options) => {
        if (active && options.length > 0) setNamespaces(options);
      })
      .catch(() => {
        // The personal namespace stays available even when the list is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!target) return;
    let active = true;
    setOptionsPending(true);
    fetchForkDefaults(owner, name, target)
      .then((defaults) => {
        if (!active) return;
        if (!editedName.current) setRepositoryName(defaults.name);
        setVisibility(defaults.visibility === "private" ? "private" : "public");
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setOptionsPending(false);
      });
    return () => {
      active = false;
    };
  }, [target, owner, name]);

  function start() {
    if (!account) {
      navigate("/signin");
      return;
    }
    editedName.current = false;
    setTarget(account.username);
    setNamespaces([{ type: "user", login: account.username }]);
    setRepositoryName("");
    setVisibility(privateSource ? "private" : "public");
    setNameError(null);
    setError(null);
    setOpen(true);
  }

  async function createFork() {
    if (busy) return;
    setBusy(true);
    setNameError(null);
    setError(null);
    try {
      const repository = await createForkRepository(owner, name, {
        owner: target,
        name: repositoryName.trim(),
        visibility,
      });
      setOpen(false);
      navigate(repositoryOverviewPath(repository.owner.login, repository.name));
    } catch (caught) {
      const fields = readErrorFields(caught);
      setNameError(fields.name ?? null);
      if (fields.visibility) setError(fields.visibility);
      else if (!fields.name) setError(apiErrorMessage(caught, "The fork could not be created."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fork-entry">
      <Button variant="secondary" onClick={start}>
        Fork
      </Button>
      {open ? (
        <Dialog
          open
          title="Create a new fork"
          onOpenChange={(next) => {
            if (!busy && !next) setOpen(false);
          }}
        >
        <form
          className="repository-form"
          aria-label="Create a new fork"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void createFork();
          }}
        >
          <FormField id="fork-owner" label="Owner">
            <select
              id="fork-owner"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              {namespaces.map((option) => (
                <option key={`${option.type}:${option.login}`} value={option.login}>
                  {option.login}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="fork-name" label="Repository name" error={nameError ?? undefined}>
            <input
              id="fork-name"
              type="text"
              value={repositoryName}
              placeholder="Repository name"
              onChange={(event) => {
                editedName.current = true;
                setRepositoryName(event.target.value);
              }}
            />
          </FormField>
          <VisibilityChoice
            groupName="fork-visibility"
            legend="Visibility"
            value={visibility}
            onChange={setVisibility}
            publicDisabled={privateSource}
          />
          {optionsPending ? (
            <p role="status" className="form-message">
              Loading fork options…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="form-message form-message--error">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy}>
            Create fork
          </Button>
        </form>
        </Dialog>
      ) : null}
    </div>
  );
}
