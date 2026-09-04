import { resolve } from "node:path";

export interface CliOptions {
  requirementsDir: string;
  outputDir: string;
  budgetMs: number;
}

const KNOWN_OPTIONS = new Set([
  "--requirements-dir",
  "--output-dir",
  "--budget-ms",
]);

export function parseCliArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    if (!KNOWN_OPTIONS.has(option)) {
      throw new Error(`Unknown argument: ${option}`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}`);
    }
    values.set(option, value);
  }

  const requirementsDir = required(values, "--requirements-dir");
  const outputDir = required(values, "--output-dir");
  const budgetText = required(values, "--budget-ms");
  const budgetMs = Number(budgetText);
  if (!Number.isSafeInteger(budgetMs) || budgetMs <= 0) {
    throw new Error(`--budget-ms must be a positive integer, received: ${budgetText}`);
  }

  return {
    requirementsDir: resolve(requirementsDir),
    outputDir: resolve(outputDir),
    budgetMs,
  };
}

function required(values: Map<string, string>, option: string): string {
  const value = values.get(option);
  if (value === undefined) {
    throw new Error(`Missing required argument: ${option}`);
  }
  return value;
}
