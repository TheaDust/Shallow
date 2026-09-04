import { readFile } from "node:fs/promises";

import type { PlatformContract } from "./types.js";

export interface GatewayConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function readGatewayConfig(
  env: Record<string, string | undefined>,
): GatewayConfig {
  const apiKey = requiredEnv(env, "OPENAI_API_KEY");
  const baseUrl = requiredEnv(env, "OPENAI_BASE_URL").replace(/\/+$/, "");
  const model = requiredEnv(env, "MODEL");
  return { apiKey, baseUrl, model };
}

export async function readEnvFile(
  envFile: string,
): Promise<Record<string, string>> {
  let content: string;
  try {
    content = await readFile(envFile, "utf8");
  } catch {
    return {};
  }

  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function createArcPlatformContract(
  platform: NodeJS.Platform = process.platform,
): PlatformContract {
  const npm = platform === "win32" ? "npm.cmd" : "npm";
  return {
    baseUrl: "http://127.0.0.1:3000",
    port: 3000,
    installCommands: [
      {
        executable: npm,
        args: ["install", "--no-audit", "--no-fund"],
        cwd: "frontend",
      },
      {
        executable: npm,
        args: ["install", "--no-audit", "--no-fund"],
        cwd: "backend",
      },
    ],
    buildCommands: [
      { executable: npm, args: ["run", "build"], cwd: "frontend" },
    ],
    startCommand: {
      executable: npm,
      args: ["run", "start"],
      cwd: "backend",
    },
    healthPath: "/health",
    buildTimeoutMs: 180_000,
    startTimeoutMs: 30_000,
  };
}

export function deriveModelTimeouts(totalBudgetMs: number): {
  builderTimeoutMs: number;
  plannerTimeoutMs: number;
} {
  if (totalBudgetMs <= 0) {
    return {
      builderTimeoutMs: 240_000,
      plannerTimeoutMs: 60_000,
    };
  }
  return {
    builderTimeoutMs: Math.max(30_000, Math.min(240_000, totalBudgetMs * 0.4)),
    plannerTimeoutMs: Math.max(10_000, Math.min(60_000, totalBudgetMs * 0.1)),
  };
}

function requiredEnv(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
