// Organization audit log (REQ-2-4): the persisted record of organization-level
// actions and the exact action names the audit-log table and its filter show.
//
// One stored event is `{ id, organizationId, actorName, action, target,
// createdAt }`. Events are appended inside the same store update as the change
// they describe, so a recorded action and its event can never diverge.

import { randomUUID } from "node:crypto";

export const AUDIT_ACTIONS = {
  organizationCreated: "Organization created",
  memberAdded: "Member added",
  memberRemoved: "Member removed",
  teamCreated: "Team created",
  repositoryCreated: "Repository created",
  accessGranted: "Access granted",
};

/** One stored event, as the read-only audit-log page receives it. */
export function publicAuditEvent(event) {
  if (!event) return null;
  return {
    id: event.id,
    actor: event.actorName ?? "",
    action: event.action,
    target: event.target ?? "",
    timestamp: event.createdAt,
  };
}

/**
 * Appends one event to a draft state. Called from inside the mutator of the
 * operation it records, so the change and its event share one atomic write.
 */
export function recordAuditEvent(draft, { organizationId, actorName, action, target, createdAt }) {
  if (!Array.isArray(draft.auditEvents)) draft.auditEvents = [];
  draft.auditEvents.push({
    id: `audit-${randomUUID()}`,
    organizationId,
    actorName: actorName ?? "",
    action,
    target: target ?? "",
    createdAt: createdAt ?? new Date().toISOString(),
  });
}
