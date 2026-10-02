// Seed data for the branch protection rules of the public repository
// `acme-docs`.
//
// A rule is a persistent merge restriction bound to one exact branch name of
// one repository, storing the branch name verbatim and the two independently
// selectable requirements this product supports: "at least 1 valid Approve from
// someone other than the PR author" and "required check `test` is success".
//
// The seeded rule protects the default branch `main`, so the mergeable and the
// blocked pull requests of the module start from the same protected target
// branch: their merge eligibility is evaluated against the stored rule without
// any preparation step. The rule is created by the repository Admin
// `alice-dev`; a repository Admin can later save the same exact branch name
// again to change the two toggles (the form then offers `Save changes`), and
// the repository keeps a branch whose name carries no rule, so the creation
// path of a new rule stays available.

const SEED_PROTECTION_TIMESTAMP = "2024-01-08T08:00:00.000Z";

export const SEED_BRANCH_PROTECTION_RULES = [
  {
    id: "branch-protection-acme-docs-main",
    repositoryId: "repository-acme-demo-acme-docs",
    branchName: "main",
    requireApproval: true,
    requireStatusCheck: true,
    createdById: "account-alice-dev",
    createdAt: SEED_PROTECTION_TIMESTAMP,
    updatedById: "account-alice-dev",
    updatedAt: SEED_PROTECTION_TIMESTAMP,
  },
];
