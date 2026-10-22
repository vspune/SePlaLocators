import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { projectRoot, startFixtureServer, testDir } from "./helpers.mjs";

let server, client, transport, otherCwd;
let stderrLog = "";
const outDir = path.join(testDir, ".output-mcp");

before(async () => {
  server = await startFixtureServer();
  // Launch from an unrelated folder, the way an MCP client usually does.
  otherCwd = await mkdtemp(path.join(os.tmpdir(), "lf-cwd-"));
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, "dist/mcpServer.js")],
    cwd: otherCwd,
    env: {
      ...process.env,
      // Relative path: must resolve against the project root, not the launch folder.
      LOCATORS_DIR: path.relative(projectRoot, outDir),
      UPLOAD_DIR: "test/fixtures",
      ALLOWED_HOSTS: "127.0.0.1",
      SELENIUM_VALIDATION: "false"
    },
    stderr: "pipe"
  });
  client = new Client({ name: "locatorfinder-test", version: "1.0.0" });
  await client.connect(transport);
  transport.stderr?.on("data", chunk => { stderrLog += chunk.toString(); });
});

after(async () => {
  await client?.close().catch(() => undefined);
  await server?.close();
  await rm(otherCwd, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
});

const text = result => result.content.map(c => c.text).join("\n");

test("lists the four tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ["get_all_locators", "login", "open_url", "perform_action"]);
});

test("open_url enforces ALLOWED_HOSTS", async () => {
  const blocked = await client.callTool({ name: "open_url", arguments: { url: "https://example.com/" } });
  assert.equal(blocked.isError, true);
  assert.match(text(blocked), /ALLOWED_HOSTS/);
});

test("open + get_all_locators writes into the project folder, not the launch folder", async () => {
  const opened = await client.callTool({ name: "open_url", arguments: { url: `${server.baseUrl}/edge-cases.html` } });
  assert.equal(opened.isError, undefined, text(opened));
  const scanned = await client.callTool({ name: "get_all_locators", arguments: {} });
  assert.equal(scanned.isError, undefined, text(scanned));
  assert.match(text(scanned), /Selenium: skipped/);
  assert.match(text(scanned), /Output folder: /);
  const folders = await readdir(outDir);
  assert.equal(folders.length, 1);
  assert.equal(existsSync(path.join(otherCwd, "locators")), false);
});

test("perform_action works and upload is limited to UPLOAD_DIR", async () => {
  const click = await client.callTool({ name: "perform_action", arguments: { action: "fill", target: "xpath=//input[@placeholder='Email']", value: "qa@example.com" } });
  assert.equal(click.isError, undefined, text(click));
  const escape = await client.callTool({ name: "perform_action", arguments: { action: "upload", target: "input", value: "../../package.json" } });
  assert.equal(escape.isError, true);
  assert.match(text(escape), /refused/);
});

test("ALLOWED_HOSTS also blocks navigation triggered by a click", async () => {
  await client.callTool({ name: "open_url", arguments: { url: `${server.baseUrl}/blank.html` } });
  const click = await client.callTool({ name: "perform_action", arguments: { action: "click", target: "#external" } });
  assert.doesNotMatch(text(click), /example\.com\/out/);
  await new Promise(r => setTimeout(r, 500));
  assert.match(stderrLog, /Blocked navigation to non-allowed host: example\.com/);
});

test("server exits (and closes Chromium) when the client disconnects", async () => {
  const pid = transport.pid;
  await client.close();
  const deadline = Date.now() + 10_000;
  let alive = true;
  while (alive && Date.now() < deadline) {
    try { process.kill(pid, 0); await new Promise(r => setTimeout(r, 200)); } catch { alive = false; }
  }
  assert.equal(alive, false, "server process still running");
});
