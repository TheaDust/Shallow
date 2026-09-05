import { readFile } from "node:fs/promises";

import { parse } from "yaml";

import type {
  AtomicRequirement,
  ProductContext,
  ProductKind,
  RequirementCatalog,
} from "./types.js";

type NodeType = "ROOT" | "FOLDER" | "ATOMIC";

interface ParsedNode {
  id: string;
  name: string;
  type: NodeType;
  description: string;
  dependencies: string[];
  children: ParsedNode[];
  scenarios: ParsedScenario[];
}

interface ParsedScenario {
  name: string;
  steps: Array<{ keyword: string; content: string }>;
}

export async function loadRequirementCatalog(
  requirementsFile: string,
): Promise<RequirementCatalog> {
  const source = await readFile(requirementsFile, "utf8");
  const root = parseNode(parse(source), "root");
  const nodes = new Map<string, ParsedNode>();
  collectNodes(root, nodes);
  validateDependencies(nodes);

  const requirements: AtomicRequirement[] = [];
  const product: ProductContext = {
    kind: classifyProduct(root.name),
    rootId: root.id,
    rootName: root.name,
    description: root.description,
  };
  collectAtomics(root, [], [], product, requirements);

  return {
    requirements,
    statusById: Object.fromEntries(
      requirements.map((requirement) => [requirement.id, "todo"]),
    ),
  };
}

function classifyProduct(rootName: string): ProductKind {
  if (rootName === "GitHub Collaboration Platform Core Requirements") {
    return "repository_collaboration";
  }
  if (rootName === "Core Requirements for an Online Spreadsheet Data Workspace") {
    return "spreadsheet";
  }
  return "generic_web";
}

function parseNode(value: unknown, location: string): ParsedNode {
  const record = requireRecord(value, location);
  const id = requireString(record.id, `${location}.id`);
  const name = requireString(record.name, `${location}.name`);
  const type = requireNodeType(record.type, `${location}.type`);
  const description = requireString(record.description ?? "", `${location}.description`);
  const dependencies = requireStringArray(
    record.dependencies ?? [],
    `${location}.dependencies`,
  );
  const children = requireArray(record.children ?? [], `${location}.children`).map(
    (child, index) => parseNode(child, `${location}.children[${index}]`),
  );
  const scenarios = requireArray(record.scenarios ?? [], `${location}.scenarios`).map(
    (scenario, index) => parseScenario(scenario, `${location}.scenarios[${index}]`),
  );

  return { id, name, type, description, dependencies, children, scenarios };
}

function parseScenario(value: unknown, location: string): ParsedScenario {
  const record = requireRecord(value, location);
  const name = requireString(record.name, `${location}.name`);
  const steps = requireArray(record.steps ?? [], `${location}.steps`).map(
    (step, index) => {
      const stepRecord = requireRecord(step, `${location}.steps[${index}]`);
      return {
        keyword: requireString(
          stepRecord.keyword,
          `${location}.steps[${index}].keyword`,
        ),
        content: requireString(
          stepRecord.content,
          `${location}.steps[${index}].content`,
        ),
      };
    },
  );
  return { name, steps };
}

function collectNodes(node: ParsedNode, nodes: Map<string, ParsedNode>): void {
  if (nodes.has(node.id)) {
    throw new Error(`Duplicate requirement id: ${node.id}`);
  }
  nodes.set(node.id, node);
  for (const child of node.children) {
    collectNodes(child, nodes);
  }
}

function validateDependencies(nodes: Map<string, ParsedNode>): void {
  for (const node of nodes.values()) {
    for (const dependency of node.dependencies) {
      if (!nodes.has(dependency)) {
        throw new Error(`Unknown dependency ${dependency} referenced by ${node.id}`);
      }
    }
  }

  const colors = new Map<string, "visiting" | "visited">();
  const visit = (id: string, path: string[]): void => {
    const color = colors.get(id);
    if (color === "visiting") {
      throw new Error(`Dependency cycle: ${[...path, id].join(" -> ")}`);
    }
    if (color === "visited") return;

    colors.set(id, "visiting");
    const node = nodes.get(id);
    if (!node) throw new Error(`Unknown requirement: ${id}`);
    for (const dependency of node.dependencies) {
      visit(dependency, [...path, id]);
    }
    colors.set(id, "visited");
  };

  for (const id of nodes.keys()) visit(id, []);
}

function collectAtomics(
  node: ParsedNode,
  folderPath: string[],
  ancestors: ParsedNode[],
  product: ProductContext,
  requirements: AtomicRequirement[],
): void {
  if (node.type === "ATOMIC") {
    const scenarios = node.scenarios.map(formatScenario);
    const evidenceText = [node.description, ...scenarios].join("\n");
    requirements.push({
      id: node.id,
      folderPath,
      declarationIndex: requirements.length,
      name: node.name,
      text: node.description,
      dependencyIds: [...node.dependencies],
      scenarios,
      references: extractReferences(node.description),
      exactUiStrings: extractUiStrings(evidenceText),
      product,
      ancestors: ancestors.map((ancestor) => ({
        id: ancestor.id,
        name: ancestor.name,
        description: ancestor.description,
      })),
    });
    return;
  }

  const nextPath = [...folderPath, node.id];
  const nextAncestors = folderPath.length === 0
    ? ancestors
    : [...ancestors, node];
  for (const child of node.children) {
    collectAtomics(child, nextPath, nextAncestors, product, requirements);
  }
}

function formatScenario(scenario: ParsedScenario): string {
  return [
    scenario.name,
    ...scenario.steps.map((step) => `${step.keyword}: ${step.content}`),
  ].join("\n");
}

function extractReferences(text: string): string[] {
  return [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
}

function extractUiStrings(text: string): string[] {
  const values: Array<{ index: number; value: string }> = [];
  for (const pattern of [/“([^”]+)”/g, /`([^`]+)`/g]) {
    for (const match of text.matchAll(pattern)) {
      values.push({ index: match.index, value: match[1] });
    }
  }
  return values.sort((left, right) => left.index - right.index).map(({ value }) => value);
}

function requireRecord(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, location: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${location} must be an array`);
  return value;
}

function requireString(value: unknown, location: string): string {
  if (typeof value !== "string") throw new Error(`${location} must be a string`);
  return value;
}

function requireStringArray(value: unknown, location: string): string[] {
  return requireArray(value, location).map((item, index) =>
    requireString(item, `${location}[${index}]`),
  );
}

function requireNodeType(value: unknown, location: string): NodeType {
  if (value === "ROOT" || value === "FOLDER" || value === "ATOMIC") return value;
  throw new Error(`${location} must be ROOT, FOLDER, or ATOMIC`);
}
