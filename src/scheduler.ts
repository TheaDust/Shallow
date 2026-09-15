import type { AtomicRequirement, RequirementCatalog, WorkPacket } from "./types.js";

/** Complete ROOT child subtrees; mutually dependent modules are built together. */
export function implementationPackets(catalog: RequirementCatalog): WorkPacket[] {
  const modules = new Map<string, AtomicRequirement[]>();
  const owner = new Map<string, string>();
  for (const requirement of catalog.requirements) {
    const moduleId = requirement.folderPath[1] ?? requirement.id;
    modules.set(moduleId, [...(modules.get(moduleId) ?? []), requirement]);
    owner.set(requirement.id, moduleId);
  }
  const dependencies = new Map([...modules].map(([id, items]) => [id, new Set(items
    .flatMap(item => item.dependencyIds.map(dependency => owner.get(dependency)!))
    .filter(dependency => dependency !== id))]));
  const reachable = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...(dependencies.get(from) ?? [])].some(id => reachable(id, to, seen));
  };
  const remaining = new Set(modules.keys());
  const groups: string[][] = [];
  for (const id of modules.keys()) {
    if (!remaining.has(id)) continue;
    const group = [...remaining].filter(other => reachable(id, other) && reachable(other, id));
    group.forEach(item => remaining.delete(item));
    groups.push(group);
  }
  const ordered: WorkPacket[] = [];
  const built = new Set<string>();
  while (groups.length) {
    const index = groups.findIndex(group => group.every(id => [...dependencies.get(id)!]
      .every(dependency => group.includes(dependency) || built.has(dependency))));
    if (index < 0) throw new Error("Module dependency graph cannot be ordered");
    const group = groups.splice(index, 1)[0];
    const requirements = group.flatMap(id => modules.get(id)!).sort((a, b) => a.declarationIndex - b.declarationIndex);
    ordered.push(makePacket(`module-${group.map(slugify).join("__")}`, requirements));
    group.forEach(id => built.add(id));
  }
  return ordered;
}

/** Audit atomics independently, with textual prerequisites but no application source. */
export function auditPackets(catalog: RequirementCatalog): WorkPacket[] {
  return catalog.requirements.map(requirement => {
    const dependencies = new Set<string>();
    const visit = (item: AtomicRequirement): void => {
      for (const id of item.dependencyIds) {
        if (dependencies.has(id)) continue;
        dependencies.add(id);
        const dependency = catalog.requirements.find(candidate => candidate.id === id);
        if (dependency) visit(dependency);
      }
    };
    visit(requirement);
    return { ...makePacket(`packet-${slugify(requirement.id)}`, [requirement]),
      prerequisites: catalog.requirements.filter(item => dependencies.has(item.id)) };
  });
}

export function makePacket(id: string, requirements: AtomicRequirement[], attempt: 1 | 2 | 3 = 1): WorkPacket {
  return { id, requirements, requirementIds: requirements.map(item => item.id), attempt };
}

/** Folder (and ROOT) id -> ids of its ATOMIC descendants, in declaration order. */
export function folderDescendants(catalog: RequirementCatalog): Map<string, string[]> {
  const folders = new Map<string, string[]>();
  for (const requirement of catalog.requirements) {
    for (const folderId of requirement.folderPath) {
      folders.set(folderId, [...(folders.get(folderId) ?? []), requirement.id]);
    }
  }
  return folders;
}

function slugify(id: string): string { return id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
