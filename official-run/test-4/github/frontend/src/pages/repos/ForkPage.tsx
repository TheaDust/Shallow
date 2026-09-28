import { useEffect, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { Account } from "../../lib/account-api";
import { navigate } from "../../lib/hash-route";
import { listOrganizations, OrganizationSummary } from "../../lib/org-api";
import { createFork, repoHref, RepoDetail, RepoOwnerType } from "../../lib/repo-api";
import { useSession } from "../../session";
import { useRepoDetail } from "./useRepoDetail";

interface ForkPageProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
}

/**
 * Fork flow: the source overview's “Fork” button opens this form, which
 * defaults to the signed-in user's personal namespace and an allowed
 * visibility, with the “Repository name” field prefilled from the source so
 * submission succeeds after editing only the name. Both ends are validated
 * server-side; a conflict keeps the form open with a field error.
 */
export function ForkPage({ ownerType, ownerName, repoName }: ForkPageProps) {
  const { status, account } = useSession();
  const { status: detailStatus, repository } = useRepoDetail(ownerType, ownerName, repoName);

  if (status !== "authenticated" || !account) {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Sign in to fork this repository.</p>
          <p>
            <a href="#/signin">Sign in</a>
          </p>
        </main>
      </AppHeader>
    );
  }

  if (detailStatus === "denied") {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Access denied</p>
        </main>
      </AppHeader>
    );
  }

  if (detailStatus !== "ready" || !repository) {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Loading…</p>
        </main>
      </AppHeader>
    );
  }

  return (
    <AppHeader>
      <ForkForm
        sourceOwnerType={ownerType}
        sourceOwner={ownerName}
        sourceRepo={repoName}
        repository={repository}
        account={account}
      />
    </AppHeader>
  );
}

function ForkForm({
  sourceOwnerType,
  sourceOwner,
  sourceRepo,
  repository,
  account,
}: {
  sourceOwnerType: RepoOwnerType;
  sourceOwner: string;
  sourceRepo: string;
  repository: RepoDetail;
  account: Account;
}) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [namespace, setNamespace] = useState<RepoOwnerType | "account">("account");
  const [namespaceName, setNamespaceName] = useState(account.username);
  const [name, setName] = useState(repository.name);
  const [visibility, setVisibility] = useState<"public" | "private">(repository.visibility);
  const [error, setError] = useState<string | null>(null);
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

  const sourcePrivate = repository.visibility === "private";
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
    setError(null);
    const outcome = await createFork({
      sourceOwnerType,
      sourceOwner,
      sourceRepo,
      targetOwnerType: selectedNamespace.ownerType,
      targetOwner: selectedNamespace.ownerName,
      name,
      visibility,
    });
    setSubmitting(false);
    if (!outcome.ok) {
      setError(outcome.errors.name ?? null);
      return;
    }
    navigate(`${repoHref(outcome.repository).slice(1)}`);
  }

  return (
    <main>
      <h1>{sourceOwner}/{sourceRepo}</h1>
      <p>
        Create a fork of <strong>{sourceRepo}</strong>.
      </p>
      <form
        className="account-form fork-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="account-form__field">
          <label htmlFor="fork-owner">Owner</label>
          <select
            id="fork-owner"
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
          <label htmlFor="fork-name">Repository name</label>
          <input
            id="fork-name"
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            autoComplete="off"
          />
          {error && <p className="account-form__error">{error}</p>}
        </div>
        <fieldset className="account-form__field fork-form__visibility">
          <legend>Visibility</legend>
          <label className="account-form__checkbox">
            <input
              type="radio"
              name="fork-visibility"
              value="private"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
            />
            Private
          </label>
          <label className="account-form__checkbox">
            <input
              type="radio"
              name="fork-visibility"
              value="public"
              checked={visibility === "public"}
              disabled={sourcePrivate}
              onChange={() => setVisibility("public")}
            />
            Public
            {sourcePrivate && (
              <span className="account-form__hint"> A private source always forks as Private.</span>
            )}
          </label>
        </fieldset>
        <button type="submit" className="button button--primary" disabled={submitting}>
          Create fork
        </button>
      </form>
    </main>
  );
}
