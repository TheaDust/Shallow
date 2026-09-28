import { useEffect, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { Account } from "../../lib/account-api";
import { navigate } from "../../lib/hash-route";
import { listOrganizations, OrganizationSummary } from "../../lib/org-api";
import {
  createRepository,
  RepoFieldErrors,
  repoHref,
  RepoOwnerType,
} from "../../lib/repo-api";
import { useSession } from "../../session";

/**
 * Repository creation page opened from the workspace's “New repository” link.
 * The Owner select defaults to the signed-in user's personal namespace and
 * lists the organizations the user may create repositories for; visibility
 * and README initialization are selectable, and every check is validated
 * server-side so a rejected submission keeps the form open unchanged.
 */
export function NewRepositoryPage() {
  const { status, account } = useSession();

  if (status === "loading") {
    return (
      <AppHeader>
        <main>
          <h1>Create a new repository</h1>
          <p>Loading…</p>
        </main>
      </AppHeader>
    );
  }

  if (status !== "authenticated" || !account) {
    return (
      <AppHeader>
        <main>
          <h1>Create a new repository</h1>
          <p>Sign in to create a repository.</p>
          <p>
            <a href="#/signin">Sign in</a>
          </p>
        </main>
      </AppHeader>
    );
  }

  return (
    <AppHeader>
      <RepositoryForm account={account} />
    </AppHeader>
  );
}

function RepositoryForm({ account }: { account: Account }) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [namespace, setNamespace] = useState<RepoOwnerType | "account">("account");
  const [namespaceName, setNamespaceName] = useState(account.username);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [initReadme, setInitReadme] = useState(false);
  const [errors, setErrors] = useState<RepoFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listOrganizations()
      .then((orgs) => {
        if (!cancelled) setOrganizations(orgs);
      })
      .catch(() => {
        if (!cancelled) setOrganizations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const namespaceOptions: { ownerType: RepoOwnerType; ownerName: string }[] = [
    { ownerType: "account", ownerName: account.username },
    ...organizations
      .filter((organization) => organization.role === "owner")
      .map((organization) => ({ ownerType: "organization" as const, ownerName: organization.name })),
  ];
  const selected = namespaceOptions.find(
    (option) => option.ownerType === namespace && option.ownerName === namespaceName,
  );
  const selectedNamespace = selected ?? namespaceOptions[0];

  async function submit() {
    if (!selectedNamespace || submitting) return;
    setSubmitting(true);
    setErrors({});
    const outcome = await createRepository({
      ownerType: selectedNamespace.ownerType,
      owner: selectedNamespace.ownerName,
      name,
      description,
      visibility,
      initReadme,
    });
    setSubmitting(false);
    if (!outcome.ok) {
      setErrors(outcome.errors);
      return;
    }
    navigate(`${repoHref(outcome.repository).slice(1)}`);
  }

  return (
    <main>
      <h1>Create a new repository</h1>
      <p>
        Create a repository in your personal namespace or an organization you
        own. The owner, visibility, and initialization options are validated
        when you submit.
      </p>
      <form
        className="account-form fork-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="account-form__field">
          <label htmlFor="new-repo-owner">Owner</label>
          <select
            id="new-repo-owner"
            value={`${selectedNamespace.ownerType}:${selectedNamespace.ownerName}`}
            onChange={(event) => {
              const [targetType, ...rest] = event.target.value.split(":");
              setNamespace(targetType as RepoOwnerType);
              setNamespaceName(rest.join(":"));
            }}
          >
            {namespaceOptions.map((option) => (
              <option key={`${option.ownerType}:${option.ownerName}`} value={`${option.ownerType}:${option.ownerName}`}>
                {option.ownerName}
              </option>
            ))}
          </select>
        </div>
        <div className="account-form__field">
          <label htmlFor="new-repo-name">Repository name</label>
          <input
            id="new-repo-name"
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
            }}
            autoComplete="off"
          />
          {errors.name && <p className="account-form__error">{errors.name}</p>}
        </div>
        <div className="account-form__field">
          <label htmlFor="new-repo-description">Description</label>
          <input
            id="new-repo-description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            autoComplete="off"
          />
        </div>
        <fieldset className="account-form__field fork-form__visibility">
          <legend>Visibility</legend>
          <label className="account-form__checkbox">
            <input
              type="radio"
              name="new-repo-visibility"
              value="public"
              checked={visibility === "public"}
              onChange={() => {
                setVisibility("public");
                if (errors.visibility) setErrors((current) => ({ ...current, visibility: undefined }));
              }}
            />
            Public
          </label>
          <label className="account-form__checkbox">
            <input
              type="radio"
              name="new-repo-visibility"
              value="private"
              checked={visibility === "private"}
              onChange={() => {
                setVisibility("private");
                if (errors.visibility) setErrors((current) => ({ ...current, visibility: undefined }));
              }}
            />
            Private
          </label>
          {errors.visibility && <p className="account-form__error">{errors.visibility}</p>}
        </fieldset>
        <div className="account-form__field">
          <label className="account-form__checkbox">
            <input
              type="checkbox"
              checked={initReadme}
              onChange={(event) => setInitReadme(event.target.checked)}
            />
            Add a README file
          </label>
        </div>
        <button type="submit" className="button button--primary" disabled={submitting}>
          Create repository
        </button>
      </form>
    </main>
  );
}
