// Persisted audit log of organization actions (REQ-2-4).
//
// Every record belongs to exactly one organization and stores the actor name,
// the action type, the target and the moment it happened. The records live in
// the same `organizations.json` file as the organizations they describe, and
// they are written through the same serialized writer, so an audit entry can
// never outlive a rejected organization operation.

import { randomUUID } from "node:crypto";

const COLLECTION = "auditEvents";

/** Public record of one organization action; the stored shape is the same. */
function publicAuditEvent(event) {
  return {
    id: event.id,
    actor: event.actor,
    action: event.action,
    target: event.target,
    timestamp: event.timestamp,
  };
}

export function createAuditStore(store) {
  async function readEvents() {
    const state = await store.read();
    return Array.isArray(state[COLLECTION]) ? state[COLLECTION] : [];
  }

  return {
    /** Newest first, so the overview of recent actions reads top to bottom. */
    async listOrganizationAuditEvents(organizationId) {
      const events = (await readEvents()).filter((entry) => entry.organizationId === organizationId);
      return events
        .map(publicAuditEvent)
        .sort((left, right) => (left.timestamp < right.timestamp ? 1 : left.timestamp > right.timestamp ? -1 : 0));
    },

    /** Appends one action of an organization; returns the stored record. */
    async recordOrganizationAuditEvent({ organizationId, actor, action, target, timestamp }) {
      const event = {
        id: `audit-${randomUUID()}`,
        organizationId,
        actor,
        action,
        target,
        timestamp: timestamp ?? new Date().toISOString(),
      };
      await store.update((draft) => {
        if (!Array.isArray(draft[COLLECTION])) draft[COLLECTION] = [];
        draft[COLLECTION].push(event);
      });
      return publicAuditEvent(event);
    },
  };
}
