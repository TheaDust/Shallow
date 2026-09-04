import type {
  AtomicRequirement,
  RequirementCatalog,
  WorkPacket,
} from "./types.js";

const MAX_PACKET_SIZE = 3;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "is",
  "of",
  "the",
  "to",
  "user",
  "when",
]);

export function selectNextPacket(
  catalog: RequirementCatalog,
): WorkPacket | undefined {
  const ready = catalog.requirements
    .filter((requirement) => isReady(requirement, catalog))
    .sort((left, right) => comparePriority(left, right, catalog));

  const seed = ready[0];
  if (!seed) return undefined;

  const related = ready
    .slice(1)
    .filter((candidate) => isRelated(seed, candidate))
    .sort((left, right) => left.declarationIndex - right.declarationIndex);
  const requirements = [seed, ...related].slice(0, MAX_PACKET_SIZE);
  const requirementIds = requirements.map((requirement) => requirement.id);

  return {
    id: `packet-${requirementIds.map(slugify).join("__")}`,
    requirementIds,
    requirements,
    attempt: 1,
  };
}

function isReady(
  requirement: AtomicRequirement,
  catalog: RequirementCatalog,
): boolean {
  if (catalog.statusById[requirement.id] !== "todo") return false;
  return requirement.dependencyIds.every(
    (dependencyId) => catalog.statusById[dependencyId] === "verified",
  );
}

function comparePriority(
  left: AtomicRequirement,
  right: AtomicRequirement,
  catalog: RequirementCatalog,
): number {
  const leftSignals = signals(left, catalog);
  const rightSignals = signals(right, catalog);
  for (let index = 0; index < leftSignals.length; index += 1) {
    const difference = rightSignals[index] - leftSignals[index];
    if (difference !== 0) return difference;
  }
  return left.declarationIndex - right.declarationIndex;
}

function signals(
  requirement: AtomicRequirement,
  catalog: RequirementCatalog,
): number[] {
  const dependentCount = catalog.requirements.filter((candidate) =>
    candidate.dependencyIds.includes(requirement.id),
  ).length;
  const descriptionCostBucket = Math.ceil(requirement.text.length / 500);
  return [
    requirement.scenarios.length,
    dependentCount,
    requirement.exactUiStrings.length,
    -descriptionCostBucket,
  ];
}

function isRelated(
  seed: AtomicRequirement,
  candidate: AtomicRequirement,
): boolean {
  if (nearestFolder(seed) !== nearestFolder(candidate)) return false;

  const seedDependencies = new Set(seed.dependencyIds);
  if (candidate.dependencyIds.some((dependency) => seedDependencies.has(dependency))) {
    return true;
  }

  const seedTerms = new Set(scenarioTerms(seed));
  return scenarioTerms(candidate).some((term) => seedTerms.has(term));
}

function nearestFolder(requirement: AtomicRequirement): string {
  return requirement.folderPath.at(-1) ?? "";
}

function scenarioTerms(requirement: AtomicRequirement): string[] {
  return requirement.scenarios
    .join(" ")
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((term) => term.length >= 4 && !STOP_WORDS.has(term)) ?? [];
}

function slugify(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
