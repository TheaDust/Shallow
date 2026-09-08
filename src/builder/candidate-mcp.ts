import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { McpRemoteConfig } from "@opencode-ai/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CandidateRuntime } from "../candidate-runtime.js";
import { sanitizeDiagnosticText } from "../diagnostics.js";
import { loadBuilderPrompt } from "./prompt-assets.js";

/** Loopback-only, authenticated, fixed-operation MCP. No command/path arguments or Judge access. */
export async function startCandidateMcp(candidate: CandidateRuntime, secrets: readonly string[] = []): Promise<{
  config: McpRemoteConfig; close(): Promise<void>;
}> {
  const authorization = `Bearer ${randomBytes(32).toString("hex")}`;
  const connections = new Set<McpServer>();
  let host = "";
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== authorization) { response.writeHead(401).end(); return; }
    if (request.url !== "/mcp") { response.writeHead(404).end(); return; }
    if (request.method !== "POST") { response.writeHead(405).end(); return; }
    const mcp = new McpServer({ name: "shallow-candidate", version: "1.0.0" });
    connections.add(mcp);
    for (const name of ["prepare", "stop"] as const) {
      mcp.registerTool(name, { description: loadBuilderPrompt("system", `candidate-${name}`), inputSchema: {} }, async () => {
        try {
          const result = name === "prepare" ? await candidate.builderPrepare() : await candidate.builderStop();
          return { content: [{ type: "text", text: JSON.stringify(result ?? { stopped: true }) }] };
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error), secrets) }] };
        }
      });
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true,
      enableDnsRebindingProtection: true, allowedHosts: [host], allowedOrigins: [] });
    response.once("close", () => { connections.delete(mcp); void mcp.close(); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response);
    } catch {
      if (!response.headersSent) response.writeHead(500).end();
      await mcp.close();
      connections.delete(mcp);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Candidate MCP did not bind a loopback port");
  host = `127.0.0.1:${address.port}`;
  return {
    config: { type: "remote", url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: authorization },
      enabled: false, oauth: false, timeout: 600_000 },
    async close() {
      try { await candidate.close(); }
      finally {
        await Promise.allSettled([...connections].map((connection) => connection.close()));
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    },
  };
}
