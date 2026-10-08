import { useEffect } from "react";

import { parseHashLocation, replace, useHashLocation } from "./hash-route";

/**
 * Keeps the active branch of a repository view in the page address (REQ-4-3-1).
 *
 * Once the loaded view knows the branch it reads, the branch is written as
 * `?branch=<name>` with a history replace, so the address identifies the branch
 * the selector, the page entry and the file list all agree on, and a reload
 * restores exactly that snapshot. The address is only completed when it names
 * no branch yet: a branch the visitor selected through the selector keeps its
 * own address, and an unmatched selector query — which never changes the branch
 * — can never change the address either.
 */
export function useBranchInAddress(path: string, branch: string): void {
  // Re-runs when the address changes, so a view that first loaded without a
  // branch still completes its address afterwards.
  const { path: currentPath, search } = useHashLocation();
  const currentBranch = search.get("branch") ?? "";

  useEffect(() => {
    if (!branch) return;
    // The live address is the source of truth: a branch the visitor already
    // selected (or that another view wrote) is never overwritten.
    const live = parseHashLocation(window.location.hash);
    if (live.path !== path) return;
    if (live.search.get("branch")) return;
    const next = new URLSearchParams(live.search.toString());
    next.set("branch", branch);
    replace(path, next);
  }, [path, branch, currentPath, currentBranch]);
}
