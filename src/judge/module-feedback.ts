import type { WorkPacket } from "../types.js";
import type { AuditResult } from "./audit.js";

/** Stable selection: one eligible new path and one previously passed dependency path. */
export function selectModuleFeedback(module: WorkPacket, packets: WorkPacket[], implemented: ReadonlySet<string>, history: ReadonlyMap<string, AuditResult>): WorkPacket[] {
  const available = new Set([...implemented, ...module.requirementIds]);
  const uses = new Map<string, number>();
  for (const packet of packets) for (const req of packet.requirements) for (const id of req.dependencyIds) uses.set(id, (uses.get(id) ?? 0) + 1);
  const eligible = packets.filter(packet => packet.requirementIds.some(id => module.requirementIds.includes(id)) &&
    packet.requirements.every(req => req.dependencyIds.every(id => available.has(id))));
  eligible.sort((a, b) => (uses.get(b.requirementIds[0]) ?? 0) - (uses.get(a.requirementIds[0]) ?? 0));
  const dependencies = new Set(module.requirements.flatMap(req => req.dependencyIds));
  const prior = packets.filter(packet => implemented.has(packet.requirementIds[0]) && history.get(packet.id)?.status === "verified");
  prior.sort((a, b) => Number(dependencies.has(b.requirementIds[0])) - Number(dependencies.has(a.requirementIds[0])));
  return [eligible[0], prior[0]].filter((packet): packet is WorkPacket => Boolean(packet));
}
