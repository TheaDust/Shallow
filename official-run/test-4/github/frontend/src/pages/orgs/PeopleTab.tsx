import { useCallback, useEffect, useRef, useState } from "react";

import {
  addOrganizationMember,
  listOrganizationMembers,
  MemberFieldErrors,
  MemberSummary,
  removeOrganizationMember,
} from "../../lib/org-api";

/**
 * People tab of the organization overview. An organization Owner may directly
 * add an existing account (by username or verified email) as a Member or Owner
 * and may remove members through each row's member menu. A non-Owner sees no
 * member-menu buttons at all; the server rejects unauthorized writes.
 */
export function PeopleTab({ orgName, isOwner }: { orgName: string; isOwner: boolean }) {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState("member");
  const [errors, setErrors] = useState<MemberFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [removingUsername, setRemovingUsername] = useState<string | null>(null);
  const [removingError, setRemovingError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    if (removingUsername) {
      content.setAttribute("inert", "");
    } else {
      content.removeAttribute("inert");
    }
  }, [removingUsername]);

  const loadMembers = useCallback(() => {
    listOrganizationMembers(orgName)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [orgName]);

  useEffect(() => {
    let cancelled = false;
    listOrganizationMembers(orgName)
      .then((result) => {
        if (!cancelled) setMembers(result);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgName]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setErrors({});
    setSubmitting(true);
    try {
      const result = await addOrganizationMember(orgName, { identifier, role });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setIdentifier("");
      setRole("member");
      setAdding(false);
      await loadMembers();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label="People">
      <div ref={contentRef} className="people-content">
        {isOwner && !adding && (
          <p>
            <button type="button" className="button" onClick={() => setAdding(true)}>
              Add member
            </button>
          </p>
        )}
        {isOwner && adding && (
          <form className="account-form account-form--inline" onSubmit={(event) => void handleAdd(event)}>
            <div className="account-form__field">
              <label htmlFor="member-identifier">Username or email</label>
              <input
                id="member-identifier"
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                aria-describedby={errors.identifier ? "member-identifier-error" : undefined}
                autoComplete="off"
              />
              {errors.identifier && (
                <p className="account-form__error" id="member-identifier-error">
                  {errors.identifier}
                </p>
              )}
            </div>
            <div className="account-form__field">
              <label htmlFor="member-role">Role</label>
              <select
                id="member-role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                aria-describedby={errors.role ? "member-role-error" : undefined}
              >
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </select>
              {errors.role && (
                <p className="account-form__error" id="member-role-error">
                  {errors.role}
                </p>
              )}
            </div>
            <button type="submit" className="button button--primary" disabled={submitting}>
              Add member
            </button>
          </form>
        )}
        {members === null ? (
          <p>Loading…</p>
        ) : (
          <ul className="member-list">
            {members.map((member) => (
              <li key={member.username} className="member-list__item">
                <span className="member-list__username">{member.username}</span>
                <span className="member-list__role">{member.role === "owner" ? "Owner" : "Member"}</span>
                {isOwner && (
                  <MemberMenu
                    username={member.username}
                    open={menuFor === member.username}
                    onToggle={() => setMenuFor(menuFor === member.username ? null : member.username)}
                    onRemove={() => {
                      setMenuFor(null);
                      setRemovingError(null);
                      setRemovingUsername(member.username);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {isOwner && removingUsername && (
        <RemoveMemberDialog
          orgName={orgName}
          username={removingUsername}
          error={removingError}
          submitting={submitting}
          onCancel={() => {
            setRemovingUsername(null);
            setRemovingError(null);
          }}
          onConfirm={async () => {
            if (submitting) return;
            setRemovingError(null);
            setSubmitting(true);
            try {
              const result = await removeOrganizationMember(orgName, removingUsername);
              if (!result.ok) {
                setRemovingError(result.errors.username ?? "Unable to remove member.");
                return;
              }
              setRemovingUsername(null);
              setMenuFor(null);
              await loadMembers();
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )}
    </section>
  );
}

function MemberMenu({
  username,
  open,
  onToggle,
  onRemove,
}: {
  username: string;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onToggle();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onToggle]);

  return (
    <div className="member-menu">
      <button
        ref={buttonRef}
        type="button"
        className="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        Member menu {username}
      </button>
      {open && (
        <ul ref={panelRef} role="menu" className="member-menu__panel" tabIndex={-1}>
          <li
            role="menuitem"
            tabIndex={0}
            onClick={onRemove}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onRemove();
              }
            }}
          >
            Remove from organization
          </li>
        </ul>
      )}
    </div>
  );
}

function RemoveMemberDialog({
  orgName,
  username,
  error,
  submitting,
  onCancel,
  onConfirm,
}: {
  orgName: string;
  username: string;
  error: string | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
        previousFocus?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      ref={dialogRef}
      className="remove-member-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-member-title"
      tabIndex={-1}
    >
      <h2 id="remove-member-title">Remove from organization</h2>
      <p>
        Remove {username} from {orgName}? Their organization memberships and direct
        repository grants will be deleted, but the account and personal repositories
        remain.
      </p>
      {error && <p className="account-form__error">{error}</p>}
      <div className="remove-member-dialog__actions">
        <button type="button" className="button button--primary" onClick={onConfirm} disabled={submitting}>
          Remove
        </button>
        <button type="button" className="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </div>
  );
}
