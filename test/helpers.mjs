import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const testDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(testDir, "..");
export const outputDir = path.join(testDir, ".output");

/** Settings shared by all tests. Must be set before any dist/ module is imported. */
export function setTestEnv() {
  process.env.LOCATORS_DIR = outputDir;
  process.env.UPLOAD_DIR = path.join(testDir, "fixtures");
  // Optional: point at a specific Chromium (e.g. when Playwright's bundled build isn't installed).
  // PLAYWRIGHT_CHROMIUM_EXECUTABLE is read by src/config.ts.
}

/** Serves test/fixtures over http://127.0.0.1:<port>/ and sets a cookie + storage on /state.html. */
export async function startFixtureServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/big.html") {
      const rows = Array.from({ length: 500 }, (_, i) =>
        `<div class="r"><span>Row ${i}</span><input name="f${i}" placeholder="p${i}"><button id="b${i}">Go</button></div>`).join("");
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><html><head><title>Big</title></head><body>${rows}</body></html>`);
    }
    try {
      const file = path.join(testDir, "fixtures", path.basename(url.pathname || "index.html"));
      const body = await readFile(file);
      const headers = { "content-type": file.endsWith(".html") ? "text/html" : "application/octet-stream" };
      if (url.pathname === "/edge-cases.html") headers["set-cookie"] = "lf_session=abc123; HttpOnly; Path=/";
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

export function launchOptions() {
  return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {};
}
