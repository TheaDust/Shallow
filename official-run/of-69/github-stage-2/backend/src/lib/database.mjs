import { join } from "node:path";

import { createJsonStore } from "./json-store.mjs";
import { createSeedAccounts, createSeedOrganizationState } from "./seed.mjs";

/**
 * Persistent domain state. Accounts hold identities plus verifiable
 * credentials; sessions hold current-browser login records that can be
 * invalidated independently of the account. `organizationState` is one
 * aggregate document: organizations, memberships, teams, team memberships and
 * organization repositories are written together, so a relationship change
 * (for example creating an organization with its Owner membership) is atomic.
 */
export function createDatabase(dataDir) {
  return {
    accounts: createJsonStore(join(dataDir, "accounts.json"), { accounts: createSeedAccounts() }),
    sessions: createJsonStore(join(dataDir, "sessions.json"), { sessions: [] }),
    organizationState: createJsonStore(join(dataDir, "organizations.json"), createSeedOrganizationState()),
  };
}
