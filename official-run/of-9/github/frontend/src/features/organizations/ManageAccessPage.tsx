import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";

import { ApiError } from "../../lib/api";
import { Button, FormField } from "../../ui";
import {
  getAccess,
  setGrant,
  REPO_ROLES,
  REPO_ROLE_LABELS,
  type AccessData,
  type GrantInfo,
  type RepoRole,
} from "./api";
import { AccessDenied } from "./AccessDenied";

interface SubjectOption {
  type: "member" | "team";
  id: string;
  name: string;
}

export function ManageAccessPage({ owner, name }: { owner: string; name: string }) {
  const [data, setData] = useState<AccessData | null>(null);
  const [denied, setDenied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState<SubjectOption | null>(null);
  const [role, setRole] = useState<RepoRole>("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setData(await getAccess(owner, name));
  };

  useEffect(() => {
    let cancelled = false;
    getAccess(owner, name)
      .then((access) => {
        if (!cancelled) setData(access);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        if (requestError instanceof ApiError && requestError.status === 404) setDenied(true);
        else setDenied(true);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  const candidates = useMemo<SubjectOption[]>(() => {
    const members: SubjectOption[] = (data?.members ?? []).map((member) => ({
      type: "member",
      id: member.username,
      name: member.username,
    }));
    const teams: SubjectOption[] = (data?.teams ?? []).map((team) => ({
      type: "team",
      id: team.id,
      name: team.name,
    }));
    const query = search.trim().toLowerCase();
    return [...members, ...teams].filter(
      (candidate) => !query || candidate.name.toLowerCase().includes(query),
    );
  }, [data, search]);

  const submitAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !subject) return;
    setBusy(true);
    setError(null);
    try {
      const result = await setGrant(owner, name, {
        subjectType: subject.type,
        subjectId: subject.id,
        role,
      });
      if (result.ok) {
        setPickerOpen(false);
        setSearch("");
        setSubject(null);
        setRole("read");
        await load();
      } else {
        setError(result.errors.subjectId ?? result.errors.role ?? null);
      }
    } finally {
      setBusy(false);
    }
  };

  const saveRow = async (grant: GrantInfo, newRole: RepoRole) => {
    const result = await setGrant(owner, name, {
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
      role: newRole,
    });
    if (result.ok) await load();
  };

  if (denied) return <AccessDenied />;
  if (!data) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  return (
    <section className="manage-access">
      <header className="manage-access__header">
        <h1>Manage access</h1>
        <p>
          {owner}/{name}
        </p>
      </header>
      {!pickerOpen ? (
        <Button variant="primary" onClick={() => setPickerOpen(true)}>
          Add people or teams
        </Button>
      ) : null}
      {pickerOpen ? (
        <form className="access-picker" aria-label="Add people or teams" onSubmit={submitAdd} noValidate>
          <FormField id="access-search" label="Search">
            <input
              id="access-search"
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSubject(null);
              }}
            />
          </FormField>
          <div role="listbox" aria-label="Subjects" className="access-picker__options">
            {candidates.map((candidate) => (
              <div
                key={`${candidate.type}:${candidate.id}`}
                role="option"
                aria-selected={subject?.id === candidate.id && subject?.type === candidate.type}
                tabIndex={0}
                className="access-picker__option"
                onClick={() => setSubject(candidate)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSubject(candidate);
                  }
                }}
              >
                {candidate.name}
              </div>
            ))}
            {candidates.length === 0 ? (
              <p className="access-picker__empty">No matching people or teams.</p>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="ui-field__error">
              {error}
            </p>
          ) : null}
          <RolePicker value={role} onChange={(next) => setRole(next)} />
          <Button type="submit" variant="primary" disabled={busy || !subject}>
            Add
          </Button>
        </form>
      ) : null}
      <table className="access-list">
        <tbody>
          {data.grants.map((grant) => (
            <GrantRow key={`${grant.subjectType}:${grant.subjectId}`} grant={grant} onSave={saveRow} />
          ))}
        </tbody>
      </table>
      {data.grants.length === 0 ? (
        <p className="access-list__empty">No people or teams have access to this repository.</p>
      ) : null}
    </section>
  );
}

// Role selector for the access picker: a combobox whose clickable role
// options are exposed as visible listbox options once the picker is open.
function RolePicker({
  value,
  onChange,
}: {
  value: RepoRole;
  onChange(role: RepoRole): void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();

  const select = (role: RepoRole) => {
    onChange(role);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + delta + REPO_ROLES.length) % REPO_ROLES.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) select(REPO_ROLES[activeIndex]);
      else setOpen(true);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="role-picker">
      <span className="role-picker__label">Role</span>
      <button
        type="button"
        role="combobox"
        aria-label="Role"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        className="role-picker__control"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        {REPO_ROLE_LABELS[value]}
      </button>
      {open ? (
        <div role="listbox" id={listboxId} aria-label="Role" className="role-picker__listbox">
          {REPO_ROLES.map((role, index) => (
            <div
              key={role}
              role="option"
              aria-selected={role === value}
              tabIndex={-1}
              className={
                index === activeIndex
                  ? "role-picker__option role-picker__option--active"
                  : "role-picker__option"
              }
              onClick={() => select(role)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  select(role);
                }
              }}
            >
              {REPO_ROLE_LABELS[role]}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GrantRow({
  grant,
  onSave,
}: {
  grant: GrantInfo;
  onSave(grant: GrantInfo, role: RepoRole): Promise<void>;
}) {
  const [role, setRole] = useState<RepoRole>(grant.role);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRole(grant.role);
  }, [grant.role]);

  return (
    <tr className="access-list__row" aria-label={grant.subjectName}>
      <td className="access-list__subject">{grant.subjectName}</td>
      <td>
        <label className="access-list__role">
          <span>Role</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as RepoRole)}
          >
            {REPO_ROLES.map((option) => (
              <option key={option} value={option}>
                {REPO_ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </td>
      <td>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onSave(grant, role).finally(() => setBusy(false));
          }}
        >
          Save
        </Button>
      </td>
    </tr>
  );
}
