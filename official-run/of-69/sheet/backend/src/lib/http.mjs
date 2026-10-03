export function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
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

function asciiFilename(filename) {
  const cleaned = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return cleaned || "worksheet.csv";
}

/** Sends UTF-8 CSV text as a downloadable attachment. */
export function sendCsv(response, filename, text) {
  response.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  response.end(text);
}
