import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  createArcPlatformContract,
  deriveModelTimeouts,
  readEnvFile,
  readGatewayConfig,
} from "../src/runtime-config.js";
import { withTempDir } from "./helpers/temp-dir.js";

test("Runtime config requires the three explicit gateway variables", () => {
  const complete = {
    OPENAI_API_KEY: "key",
    OPENAI_BASE_URL: "https://gateway.example/v1/",
    MODEL: "provider/model",
  };
  assert.deepEqual(readGatewayConfig(complete), {
    apiKey: "key",
    baseUrl: "https://gateway.example/v1",
    model: "provider/model",
  });

  for (const missing of ["OPENAI_API_KEY", "OPENAI_BASE_URL", "MODEL"] as const) {
    const env = { ...complete };
    delete env[missing];
    assert.throws(() => readGatewayConfig(env), new RegExp(missing));
  }
});

test("Runtime config expresses the ARC frontend and backend process contract", () => {
  const linux = createArcPlatformContract("linux");
  const windows = createArcPlatformContract("win32");

  assert.deepEqual(linux.installCommands, [
    {
      executable: "npm",
      args: ["install", "--no-audit", "--no-fund"],
      cwd: "frontend",
    },
    {
      executable: "npm",
      args: ["install", "--no-audit", "--no-fund"],
      cwd: "backend",
    },
  ]);
  assert.deepEqual(linux.buildCommands, [
    { executable: "npm", args: ["run", "build"], cwd: "frontend" },
  ]);
  assert.deepEqual(linux.startCommand, {
    executable: "npm",
    args: ["run", "start"],
    cwd: "backend",
  });
  assert.equal(linux.baseUrl, "http://127.0.0.1:3000");
  assert.equal(linux.healthPath, "/health");
  assert.equal(windows.startCommand.executable, "npm.cmd");
});

test("Runtime config bounds model calls by the total budget", () => {
  assert.deepEqual(deriveModelTimeouts(600_000), {
    builderTimeoutMs: 240_000,
    plannerTimeoutMs: 60_000,
  });
  assert.deepEqual(deriveModelTimeouts(60_000), {
    builderTimeoutMs: 30_000,
    plannerTimeoutMs: 10_000,
  });
  assert.deepEqual(deriveModelTimeouts(0), {
    builderTimeoutMs: 240_000,
    plannerTimeoutMs: 60_000,
  });
});

test("Runtime config parses an env file and tolerates a missing one", async () => {
  await withTempDir("shallow-env-", async (directory) => {
    const envFile = join(directory, ".env");
    await writeFile(
      envFile,
      [
        "# gateway config",
        "",
        "OPENAI_API_KEY = file-key",
        "OPENAI_BASE_URL=https://file.example/v1/",
        'MODEL="file/model"',
        "not a pair",
      ].join("\n"),
    );

    assert.deepEqual(await readEnvFile(envFile), {
      OPENAI_API_KEY: "file-key",
      OPENAI_BASE_URL: "https://file.example/v1/",
      MODEL: "file/model",
    });
    assert.deepEqual(await readEnvFile(join(directory, "absent.env")), {});
  });
});
