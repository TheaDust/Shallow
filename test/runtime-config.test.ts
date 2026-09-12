import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  createArcPlatformContract,
  deriveModelTimeouts,
  parseCgroupMemoryLimit,
  parseProbePortOverride,
  parseRunDirOverride,
  pickFreePort,
  readEnvFile,
  readGatewayConfig,
} from "../src/runtime-config.js";
import { withTempDir } from "./helpers/temp-dir.js";

test("cgroup memory limits parse v2 numbers and ignore unlimited or invalid values", () => {
  assert.equal(parseCgroupMemoryLimit("536870912\n"), 536_870_912);
  assert.equal(parseCgroupMemoryLimit("max"), undefined);
  assert.equal(parseCgroupMemoryLimit(""), undefined);
  assert.equal(parseCgroupMemoryLimit("not-a-number"), undefined);
  assert.equal(parseCgroupMemoryLimit("0"), undefined);
});

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
    builderTimeoutMs: 3_600_000,
    plannerTimeoutMs: 720_000,
  });
  assert.deepEqual(deriveModelTimeouts(10_800_000), {
    builderTimeoutMs: 3_600_000,
    plannerTimeoutMs: 720_000,
  });
  assert.deepEqual(deriveModelTimeouts(3_600_000), {
    builderTimeoutMs: 1_440_000,
    plannerTimeoutMs: 360_000,
  });
});

test("Runtime config accepts an explicit probe port and derives its base URL", () => {
  const contract = createArcPlatformContract("linux", 3100);
  assert.equal(contract.port, 3100);
  assert.equal(contract.baseUrl, "http://127.0.0.1:3100");
});

test("Runtime config keeps port 3000 as the default contract port", () => {
  const contract = createArcPlatformContract("linux");
  assert.equal(contract.port, 3000);
  assert.equal(contract.baseUrl, "http://127.0.0.1:3000");
});

test("Runtime config reads the probe port override from the environment", () => {
  assert.throws(() => parseProbePortOverride({ SHALLOW_PROBE_PORT: "3000" }), /reserved evaluation port/);
  assert.equal(parseProbePortOverride({}), null);
  assert.equal(parseProbePortOverride({ SHALLOW_PROBE_PORT: "3100" }), 3100);
  assert.equal(parseProbePortOverride({ SHALLOW_PROBE_PORT: "  3100  " }), 3100);
  assert.throws(
    () => parseProbePortOverride({ SHALLOW_PROBE_PORT: "0" }),
    /SHALLOW_PROBE_PORT/,
  );
  assert.throws(
    () => parseProbePortOverride({ SHALLOW_PROBE_PORT: "not-a-port" }),
    /SHALLOW_PROBE_PORT/,
  );
  assert.throws(
    () => parseProbePortOverride({ SHALLOW_PROBE_PORT: "70000" }),
    /SHALLOW_PROBE_PORT/,
  );
});

test("Runtime config resolves the run directory override from the environment", () => {
  assert.equal(parseRunDirOverride({}), null);
  assert.equal(parseRunDirOverride({ SHALLOW_RUN_DIR: "   " }), null);
  assert.equal(parseRunDirOverride({ SHALLOW_RUN_DIR: " runs " }), resolve("runs"));
  assert.equal(
    parseRunDirOverride({ SHALLOW_RUN_DIR: join(tmpdir(), "shallow-logs") }),
    join(tmpdir(), "shallow-logs"),
  );
});

test("Runtime config picks a free loopback port for probe binding", async () => {
  const port = await pickFreePort();
  assert.ok(Number.isInteger(port));
  assert.ok(port > 0 && port <= 65_535);
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
