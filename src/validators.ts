import { Builder, By, until, type WebDriver } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import type { BrowserContext, Page } from "playwright";
import { config, loginIsConfigured } from "./config.js";
import { parseSelector } from "./selectors.js";
import type { FrameworkRun, LocatorCandidate, LocatorInventory, ValidationStatus } from "./types.js";

function statusForCount(count: number): ValidationStatus {
  return count < 0 ? "error" : count === 1 ? "unique" : count > 1 ? "multiple" : "zero";
}

function allCandidates(inventory: LocatorInventory): LocatorCandidate[] {
  return inventory.elements.flatMap(element => element.candidates);
}

/* ------------------------------------------------------------------ */
/* Playwright                                                          */
/* ------------------------------------------------------------------ */

/**
 * Counts every candidate with Playwright's own selector engines (css= / xpath=), so results reflect
 * exactly what `page.locator()` will do in a test. Calls run concurrently in small batches; one call
 * per candidate in sequence took ~10 s for 5,000 candidates.
 */
export async function validateWithPlaywright(page: Page, inventory: LocatorInventory, concurrency = 48): Promise<FrameworkRun> {
  const started = Date.now();
  const candidates = allCandidates(inventory);
  let next = 0;

  const worker = async () => {
    while (next < candidates.length) {
      const candidate = candidates[next++];
      try {
        const count = await page.locator(`${candidate.kind}=${candidate.selector}`).count();
        candidate.playwrightCount = count;
        candidate.playwrightStatus = statusForCount(count);
      } catch {
        candidate.playwrightCount = null;
        candidate.playwrightStatus = "error";
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  const run: FrameworkRun = { status: "ok", durationMs: Date.now() - started };
  inventory.playwright = run;
  return run;
}

/* ------------------------------------------------------------------ */
/* Selenium                                                            */
/* ------------------------------------------------------------------ */

/**
 * Counting script executed in the Selenium-driven browser. WebDriver's own findElements uses
 * querySelectorAll for CSS and document.evaluate for XPath, so this gives the same counts while
 * needing one round trip per 500 selectors instead of one per selector.
 */
export const COUNT_SCRIPT = `
  return arguments[0].map(function (item) {
    try {
      if (item[0] === "css") return document.querySelectorAll(item[1]).length;
      return document.evaluate(item[1], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength;
    } catch (e) { return -1; }
  });
`;

function byFor(raw: string): By {
  const parsed = parseSelector(raw);
  return parsed.kind === "xpath" ? By.xpath(parsed.value) : By.css(parsed.value);
}

async function waitForStableDom(driver: WebDriver, timeoutMs = 10_000): Promise<void> {
  await driver.wait(async () => (await driver.executeScript("return document.readyState")) === "complete", 15_000).catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const count = Number(await driver.executeScript("return document.getElementsByTagName('*').length"));
    if (count !== last) { last = count; stableSince = Date.now(); }
    else if (Date.now() - stableSince >= 1_000) return;
    await driver.sleep(250);
  }
}

async function replayLogin(driver: WebDriver): Promise<void> {
  if (!loginIsConfigured()) throw new Error("SELENIUM_AUTH=login but login is not configured in .env.");
  await driver.get(config.loginUrl ?? config.appUrl);
  const username = await driver.wait(until.elementLocated(byFor(config.usernameSelector!)), 15_000);
  await username.sendKeys(config.username!);
  await driver.findElement(byFor(config.passwordSelector!)).sendKeys(config.password!);
  await driver.findElement(byFor(config.submitSelector!)).click();
  if (config.successSelector) {
    await driver.wait(until.elementLocated(byFor(config.successSelector)), 20_000);
  } else {
    await waitForStableDom(driver);
  }
}

type DevToolsDriver = WebDriver & { sendDevToolsCommand(cmd: string, params?: object): Promise<unknown> };

export interface StateCopyCommands {
  /** Parameters for the Chrome DevTools command Network.setCookies. */
  cookies: Record<string, unknown>[];
  /** Source for Page.addScriptToEvaluateOnNewDocument, or null when there is no storage to copy. */
  seedScript: string | null;
}

/**
 * Builds the DevTools commands that recreate the Playwright session (cookies incl. HttpOnly,
 * localStorage, sessionStorage) in another Chrome, so Selenium sees the same logged-in state
 * without logging in again. Values are only passed browser-to-browser, never written to disk.
 */
export async function buildStateCopyCommands(context: BrowserContext, page: Page): Promise<StateCopyCommands> {
  const state = await context.storageState();
  const cookies = state.cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    ...(c.expires > 0 ? { expires: c.expires } : {})
  }));

  const session = await page.evaluate(() => {
    const items: Record<string, string> = {};
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i)!;
      items[key] = window.sessionStorage.getItem(key) ?? "";
    }
    return { origin: location.origin, items };
  }).catch(() => ({ origin: "", items: {} as Record<string, string> }));

  const local = state.origins.map(o => ({ origin: o.origin, items: Object.fromEntries(o.localStorage.map(i => [i.name, i.value])) }));
  const hasStorage = local.some(o => Object.keys(o.items).length > 0) || Object.keys(session.items).length > 0;
  // Runs before any page script on every new document, so the app boots with the same storage.
  const seedScript = hasStorage ? `(() => {
    const local = ${JSON.stringify(local)};
    const session = ${JSON.stringify(session)};
    try {
      for (const entry of local) if (entry.origin === location.origin) for (const [k, v] of Object.entries(entry.items)) localStorage.setItem(k, v);
      if (session.origin === location.origin) for (const [k, v] of Object.entries(session.items)) sessionStorage.setItem(k, v);
    } catch (e) {}
  })();` : null;

  return { cookies, seedScript };
}

async function copyPlaywrightState(driver: WebDriver, context: BrowserContext, page: Page): Promise<number> {
  const devtools = driver as DevToolsDriver;
  const { cookies, seedScript } = await buildStateCopyCommands(context, page);
  if (cookies.length > 0) await devtools.sendDevToolsCommand("Network.setCookies", { cookies });
  if (seedScript) {
    // The script is only applied to new documents once the Page domain is enabled.
    await devtools.sendDevToolsCommand("Page.enable", {});
    await devtools.sendDevToolsCommand("Page.addScriptToEvaluateOnNewDocument", { source: seedScript });
  }
  return cookies.length;
}

async function buildDriver(): Promise<WebDriver> {
  const options = new chrome.Options();
  if (config.seleniumHeadless) options.addArguments("--headless=new");
  options.addArguments("--window-size=1366,900", "--no-first-run", "--no-default-browser-check");
  if (process.platform === "linux") options.addArguments("--no-sandbox", "--disable-dev-shm-usage");
  if (config.chromeBinary) options.setChromeBinaryPath(config.chromeBinary);

  const builder = new Builder().forBrowser("chrome").setChromeOptions(options);
  if (config.chromeDriverPath) builder.setChromeService(new chrome.ServiceBuilder(config.chromeDriverPath));
  return builder.build();
}

export interface SeleniumContext {
  /** Full current URL including query string (used only for navigation, never saved). */
  targetUrl: string;
  playwrightContext: BrowserContext;
  playwrightPage: Page;
}

export async function validateWithSelenium(inventory: LocatorInventory, ctx: SeleniumContext): Promise<FrameworkRun> {
  if (!config.seleniumEnabled) {
    inventory.selenium = { status: "skipped", message: "SELENIUM_VALIDATION=false" };
    return inventory.selenium;
  }

  const started = Date.now();
  const candidates = allCandidates(inventory);
  let driver: WebDriver | undefined;
  const notes: string[] = [];

  try {
    driver = await buildDriver();

    if (config.seleniumAuth === "copy") {
      const copied = await copyPlaywrightState(driver, ctx.playwrightContext, ctx.playwrightPage);
      if (copied > 0) notes.push(`copied ${copied} cookie(s) from the Playwright session`);
    } else if (config.seleniumAuth === "login") {
      await replayLogin(driver);
      notes.push("replayed configured login");
    }

    await driver.get(ctx.targetUrl);
    await waitForStableDom(driver);

    const landed = String(await driver.getCurrentUrl());
    if (new URL(landed).pathname !== new URL(ctx.targetUrl).pathname) {
      notes.push(`Selenium landed on a different path (${new URL(landed).pathname}); the page may require login or redirect, so counts can differ`);
    }

    for (let offset = 0; offset < candidates.length; offset += 500) {
      const chunk = candidates.slice(offset, offset + 500);
      const counts = await driver.executeScript(COUNT_SCRIPT, chunk.map(c => [c.kind, c.selector])) as number[];
      chunk.forEach((candidate, i) => {
        const count = Number(counts[i]);
        candidate.seleniumCount = count < 0 ? null : count;
        candidate.seleniumStatus = statusForCount(count);
      });
    }

    // Spot-check a sample with real WebDriver findElements to make sure the batched counts agree.
    const sample = candidates.filter(c => c.seleniumStatus !== "error").filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 20)) === 0).slice(0, 20);
    for (const candidate of sample) {
      const found = await driver.findElements(candidate.kind === "css" ? By.css(candidate.selector) : By.xpath(candidate.selector));
      if (found.length !== candidate.seleniumCount) {
        notes.push(`spot-check mismatch for ${candidate.selector}: batched ${candidate.seleniumCount}, findElements ${found.length}`);
        candidate.seleniumCount = found.length;
        candidate.seleniumStatus = statusForCount(found.length);
      }
    }

    inventory.selenium = { status: "ok", durationMs: Date.now() - started, ...(notes.length ? { message: notes.join("; ") } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    for (const candidate of candidates) {
      if (candidate.seleniumStatus === "not-run") candidate.seleniumStatus = "error";
    }
    inventory.selenium = { status: "failed", message, durationMs: Date.now() - started };
    console.error(`[LocatorFinder] Selenium validation could not complete: ${message}`);
  } finally {
    if (driver) await driver.quit().catch(() => undefined);
  }
  return inventory.selenium;
}

/** Candidates where both frameworks ran but returned different counts. */
export function frameworkDisagreements(inventory: LocatorInventory) {
  return inventory.elements.flatMap(element =>
    element.candidates
      .filter(c => c.playwrightCount !== null && c.seleniumCount !== null && c.playwrightCount !== c.seleniumCount)
      .map(c => ({ key: element.key, candidate: c }))
  );
}
