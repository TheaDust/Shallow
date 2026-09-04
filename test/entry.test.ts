import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  main,
  type AgentExecution,
  type AgentExecutionContext,
} from "../index.js";
import { withTempDir } from "./helpers/temp-dir.js";

test("Agent entry validates paths and passes bounded production context", async () => {
  await withTempDir("shallow-entry-", async (directory) => {
    const requirementsDir = join(directory, "requirements");
    const outputDir = join(directory, "output");
    await mkdir(requirementsDir);
    await writeFile(
      join(requirementsDir, "requirements.yaml"),
      "id: ROOT\nname: Root\ntype: FOLDER\ndependencies: []\ndescription: Root\nchildren: []\n",
    );
    let received: AgentExecutionContext | undefined;
    const execute: AgentExecution = async (context) => {
      received = context;
      return {
        status: "delivered",
        verifiedRequirementIds: [],
        blockedRequirementIds: [],
        acceptedSha: "sha",
      };
    };

    const exitCode = await main(
      [
        "--requirements-dir",
        requirementsDir,
        "--output-dir",
        outputDir,
        "--budget-ms",
        "600000",
      ],
      gatewayEnv(),
      execute,
      null,
    );

    assert.equal(exitCode, 0);
    assert.equal(received?.gateway.model, "provider/model");
    assert.equal(received?.pipelineOptions.requirementsFile, join(requirementsDir, "requirements.yaml"));
    assert.equal(received?.pipelineOptions.outputDir, outputDir);
    assert.equal(received?.pipelineOptions.totalBudgetMs, 600_000);
    assert.equal(received?.pipelineOptions.platformContract.port, 3000);
  });
});

test("Agent entry rejects a missing requirements.yaml before execution", async () => {
  await withTempDir("shallow-entry-", async (directory) => {
    let calls = 0;
    const execute: AgentExecution = async () => {
      calls += 1;
      throw new Error("must not execute");
    };

    await assert.rejects(
      main(
        [
          "--requirements-dir",
          join(directory, "missing"),
          "--output-dir",
          join(directory, "output"),
          "--budget-ms",
          "600000",
        ],
        gatewayEnv(),
        execute,
        null,
      ),
      /requirements\.yaml/,
    );
    assert.equal(calls, 0);
  });
});

test("Agent entry returns a non-zero exit code when final delivery fails", async () => {
  await withTempDir("shallow-entry-", async (directory) => {
    const requirementsDir = join(directory, "requirements");
    await mkdir(requirementsDir);
    await writeFile(
      join(requirementsDir, "requirements.yaml"),
      "id: ROOT\nname: Root\ntype: FOLDER\ndependencies: []\ndescription: Root\nchildren: []\n",
    );
    const execute: AgentExecution = async () => ({
      status: "failed",
      verifiedRequirementIds: [],
      blockedRequirementIds: [],
      acceptedSha: "sha",
    });

    const exitCode = await main(
      [
        "--requirements-dir",
        requirementsDir,
        "--output-dir",
        join(directory, "output"),
        "--budget-ms",
        "600000",
      ],
        gatewayEnv(),
        execute,
        null,
      );

      assert.equal(exitCode, 1);
  });
});

test("Agent entry loads the gateway from an env file with real env winning", async () => {
  await withTempDir("shallow-entry-", async (directory) => {
    const requirementsDir = join(directory, "requirements");
    await mkdir(requirementsDir);
    await writeFile(
      join(requirementsDir, "requirements.yaml"),
      "id: ROOT\nname: Root\ntype: FOLDER\ndependencies: []\ndescription: Root\nchildren: []\n",
    );
    await writeFile(
      join(directory, "gateway.env"),
      [
        "# gateway config",
        "OPENAI_API_KEY=file-key",
        "OPENAI_BASE_URL=https://file.example/v1",
        'MODEL="file/model"',
      ].join("\n"),
    );
    let received: AgentExecutionContext | undefined;
    const execute: AgentExecution = async (context) => {
      received = context;
      return {
        status: "delivered",
        verifiedRequirementIds: [],
        blockedRequirementIds: [],
        acceptedSha: "sha",
      };
    };
    const argv = [
      "--requirements-dir",
      requirementsDir,
      "--output-dir",
      join(directory, "output"),
      "--budget-ms",
      "0",
    ];

    await main(argv, {}, execute, join(directory, "gateway.env"));
    assert.equal(received?.gateway.apiKey, "file-key");
    assert.equal(received?.gateway.baseUrl, "https://file.example/v1");
    assert.equal(received?.gateway.model, "file/model");

    await main(argv, { MODEL: "env/model" }, execute, join(directory, "gateway.env"));
    assert.equal(received?.gateway.model, "env/model");
    assert.equal(received?.gateway.apiKey, "file-key");
  });
});

function gatewayEnv(): Record<string, string> {
  return {
    OPENAI_API_KEY: "key",
    OPENAI_BASE_URL: "https://gateway.example/v1",
    MODEL: "provider/model",
  };
}
