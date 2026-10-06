import { useEffect } from "react";

import { parseHashLocation, replace } from "./hash-route";

/**
 * Keeps the branch a repository view reads in the page address (REQ-4-3-1).
 *
 * The resolved branch — including the repository default branch — is written as
 * the `branch` search parameter of the current hash as soon as the view knows
 * it, without adding a history entry. A reload therefore restores the same
 * snapshot, and an unmatched branch query can never change the address because
 * it never changes the resolved branch.
 */
export function useBranchAddress(branch: string | null | undefined): void {
  useEffect(() => {
    const value = branch?.trim();
    if (!value) return;
    const location = parseHashLocation(window.location.hash);
    if (location.search.get("branch") === value) return;
    const search = new URLSearchParams(location.search);
    search.set("branch", value);
    replace(location.path, search);
  }, [branch]);
}
