export function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function sendText(response, status, body, headers = {}) {
  const payload = Buffer.from(String(body), "utf8");
  response.writeHead(status, { "content-length": payload.length, ...headers });
  response.end(payload);
}

export async function readJson(request, { limitBytes = 1_000_000 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
