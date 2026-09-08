import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import type { McpLocalConfig } from "@opencode-ai/sdk";

export interface BuilderSelfTestOptions {
  baseUrl: string;
  artifactsDir: string;
}

export const SELF_TEST_MCP_NAME = "playwright";
export const CANDIDATE_MCP_NAME = "candidate";

export function builderSelfTestConfig(options: BuilderSelfTestOptions): McpLocalConfig {
  const origin = new URL(options.baseUrl);
  if (origin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
    !origin.port || origin.port === "3000" || origin.username || origin.password) {
    throw new Error("Builder self-test requires a local non-evaluation port");
  }
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("@playwright/mcp/package.json")), "cli.js");
  return {
    type: "local",
    enabled: false,
    timeout: 10_000,
    command: [process.execPath, cli, "--headless", "--isolated",
      "--executable-path", chromium.executablePath(),
      "--allowed-origins", origin.origin, "--block-service-workers",
      "--image-responses", "omit", "--timeout-action", "5000", "--timeout-navigation", "15000",
      "--output-dir", resolve(options.artifactsDir)],
  };
}
