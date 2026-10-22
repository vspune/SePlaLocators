import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { closeBrowser, getBrowserContext, getPage, login, openUrl } from "./browser.js";
import { config } from "./config.js";
import { bestUniqueCandidate, saveInventory } from "./exporters.js";
import { scanDom } from "./scanner.js";
import { toPlaywrightSelector } from "./selectors.js";
import { resolveUploadPath } from "./uploads.js";
import { frameworkDisagreements, validateWithPlaywright, validateWithSelenium } from "./validators.js";

const server = new McpServer({ name: "LocatorFinder", version: "0.2.0" });

/** All tools share one browser page, so calls are serialised to avoid interleaved actions. */
let queue: Promise<unknown> = Promise.resolve();
function serialised<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (error: unknown): ToolResult => ({
  isError: true,
  content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }]
});

server.registerTool(
  "open_url",
  {
    description: "Open a URL in the LocatorFinder Playwright browser.",
    inputSchema: { url: z.string().url().describe("HTTP or HTTPS URL to open") }
  },
  ({ url }) => serialised(async () => {
    try {
      const result = await openUrl(url);
      return ok(`Opened ${result.url}\nTitle: ${result.title}`);
    } catch (error) { return fail(error); }
  })
);

server.registerTool(
  "login",
  {
    description: "Log in using credentials and selectors configured in the project's .env file. Never asks for or prints the password."
  },
  () => serialised(async () => {
    try {
      const result = await login();
      return ok(`${result.message}\nCurrent URL: ${result.url}\nTitle: ${result.title}`);
    } catch (error) { return fail(error); }
  })
);

server.registerTool(
  "get_all_locators",
  {
    description:
      "Scan the current page for interactive elements, build CSS/XPath candidates, validate them in Playwright and Selenium, " +
      "and save locator-inventory.json, playwright.locators.ts, selenium.locators.ts and review.md in one page folder. " +
      "Only locators that match exactly one element are written to the .ts files.",
    inputSchema: {
      maxElements: z.number().int().positive().optional().describe("Maximum elements to scan; defaults to MAX_ELEMENTS"),
      waitSeconds: z.number().min(0).max(30).optional().describe("Seconds to wait before scanning, e.g. so a page that just loaded after login finishes rendering")
    }
  },
  ({ maxElements, waitSeconds }) => serialised(async () => {
    try {
      const page = await getPage();
      if (page.url() === "about:blank") return fail(new Error("No page is open. Call open_url first."));
      if (waitSeconds) await page.waitForTimeout(waitSeconds * 1000);

      const targetUrl = page.url();
      const inventory = await scanDom(page, maxElements ?? config.maxElements);
      await validateWithPlaywright(page, inventory);
      await validateWithSelenium(inventory, { targetUrl, playwrightContext: await getBrowserContext(), playwrightPage: page });
      const saved = await saveInventory(inventory);

      const disagreements = frameworkDisagreements(inventory).length;
      const fragile = inventory.elements.filter(el => bestUniqueCandidate(el, "playwright")?.stability === "fragile").length;
      const summary = [
        `Scanned URL: ${inventory.pageUrl}`,
        `Page title: ${inventory.pageTitle}`,
        `Elements scanned: ${inventory.elements.length} of ${inventory.totalElements}${inventory.truncated ? " (truncated)" : ""}`,
        `Playwright: ${inventory.playwright.status} in ${inventory.playwright.durationMs ?? 0} ms; ${saved.playwrightIncluded} element(s) with a unique locator`,
        `Selenium: ${inventory.selenium.status}${inventory.selenium.durationMs ? ` in ${inventory.selenium.durationMs} ms` : ""}; ${saved.seleniumIncluded} element(s) with a unique locator` +
          (inventory.selenium.message ? `\n  Selenium detail: ${inventory.selenium.message}` : ""),
        `Elements with only a fragile unique locator: ${fragile}`,
        `Playwright/Selenium count differences: ${disagreements}`,
        `Redacted attribute values: ${inventory.stats.redactedAttributeValues}; URLs with query string removed: ${inventory.stats.strippedUrls}`,
        ...inventory.warnings.map(w => `Warning: ${w}`),
        `Output folder: ${saved.folder}`,
        "Elements without a unique locator, fragile locators and framework differences are listed in review.md."
      ].join("\n");
      return ok(summary);
    } catch (error) { return fail(error); }
  })
);

server.registerTool(
  "perform_action",
  {
    description:
      "Perform a supported action on a CSS selector or XPath selector in the current Playwright page. " +
      "Uploads are limited to files inside UPLOAD_DIR. Do not use this tool for assertions.",
    inputSchema: {
      action: z.enum(["click", "dblclick", "rightclick", "fill", "clear", "select", "check", "uncheck", "hover", "press", "scroll", "upload"]),
      target: z.string().min(1).describe("CSS selector, or XPath prefixed with xpath= (a bare XPath starting with / also works)"),
      value: z.string().optional().describe("Required for fill, select, press, and upload (file name relative to UPLOAD_DIR)")
    }
  },
  ({ action, target, value }) => serialised(async () => {
    try {
      const page = await getPage();
      const locator = page.locator(toPlaywrightSelector(target));
      const need = (what: string) => { if (value === undefined) throw new Error(`The ${action} action requires value (${what}).`); return value; };
      switch (action) {
        case "click": await locator.click(); break;
        case "dblclick": await locator.dblclick(); break;
        case "rightclick": await locator.click({ button: "right" }); break;
        case "fill": await locator.fill(need("text to enter")); break;
        case "clear": await locator.fill(""); break;
        case "select": await locator.selectOption(need("option value or label; native <select> only")); break;
        case "check": await locator.check(); break;
        case "uncheck": await locator.uncheck(); break;
        case "hover": await locator.hover(); break;
        case "press": await locator.press(need("a key such as Enter")); break;
        case "scroll": await locator.scrollIntoViewIfNeeded(); break;
        case "upload": await locator.setInputFiles(resolveUploadPath(need("file name inside UPLOAD_DIR"))); break;
      }
      return ok(`Action '${action}' completed for target '${target}'. Current URL: ${page.url()}`);
    } catch (error) { return fail(error); }
  })
);

let shuttingDown = false;
async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await closeBrowser().catch(() => undefined);
  process.exit(code);
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  // If the MCP client exits without sending a signal, stdin closes: don't leave Chromium running.
  process.stdin.on("end", () => void shutdown());
  process.stdin.on("close", () => void shutdown());
}

main().catch(error => {
  console.error("LocatorFinder MCP server failed to start:", error);
  process.exit(1);
});
