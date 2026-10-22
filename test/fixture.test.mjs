import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { launchOptions, outputDir, projectRoot, setTestEnv, startFixtureServer } from "./helpers.mjs";

setTestEnv();
const { scanDom } = await import("../dist/scanner.js");
const { validateWithPlaywright, validateWithSelenium, buildStateCopyCommands, COUNT_SCRIPT } = await import("../dist/validators.js");
const { saveInventory, bestUniqueCandidate } = await import("../dist/exporters.js");

let server, browser, context, page, inventory, saved, files;

before(async () => {
  await rm(outputDir, { recursive: true, force: true });
  server = await startFixtureServer();
  browser = await chromium.launch(launchOptions());
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(`${server.baseUrl}/edge-cases.html?session=SHOULD-NOT-BE-SAVED`);
  await page.evaluate(() => { localStorage.setItem("lf_local", "LOCAL-VAL-77"); sessionStorage.setItem("lf_session_store", "SESSION-VAL-88"); });

  inventory = await scanDom(page);
  await validateWithPlaywright(page, inventory);
  // Real Selenium run: passes when a matching Chrome + ChromeDriver exist, otherwise must fail gracefully.
  await validateWithSelenium(inventory, { targetUrl: page.url(), playwrightContext: context, playwrightPage: page });
  saved = await saveInventory(inventory);
  files = {};
  for (const name of await readdir(saved.folder)) files[name] = await readFile(path.join(saved.folder, name), "utf8");
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const byKey = key => inventory.elements.find(el => el.key === key);
const pwSelector = key => bestUniqueCandidate(byKey(key), "playwright")?.selector;

test("writes all four output files into a host+path folder", () => {
  assert.equal(path.basename(saved.folder), "127-0-0-1-" + new URL(server.baseUrl).port + "_edge-cases-html");
  assert.deepEqual(Object.keys(files).sort(), ["locator-inventory.json", "playwright.locators.ts", "review.md", "selenium.locators.ts"]);
});

test("does not save secrets, tokens, prefilled values or script source", () => {
  const all = Object.values(files).join("\n");
  for (const secret of ["SESSION-TOKEN-XYZ", "SECRET123", "jane.doe@example.com", "do-not-capture", "SHOULD-NOT-BE-SAVED", "abc123", "LOCAL-VAL-77", "SESSION-VAL-88"]) {
    assert.ok(!all.includes(secret), `output contains ${secret}`);
  }
  assert.equal(inventory.pageUrl.includes("?"), false);
  assert.ok(inventory.stats.redactedAttributeValues >= 2);
  assert.ok(inventory.stats.strippedUrls >= 1);
});

test("skips document-structure elements and hidden inputs", () => {
  const tags = new Set(inventory.elements.map(el => el.tagName));
  for (const tag of ["html", "head", "body", "script", "style", "title"]) assert.equal(tags.has(tag), false, tag);
  assert.equal(inventory.elements.some(el => el.elementType === "hidden"), false);
  assert.equal(inventory.elements.some(el => el.tagName === "circle"), false);
});

test("two buttons with the same tag get different, unique locators", () => {
  const login = pwSelector("login_button");
  const cancel = pwSelector("cancel_button");
  assert.ok(login && cancel && login !== cancel);
  assert.match(login, /Login/);
  assert.match(cancel, /Cancel/);
  assert.ok(!files["playwright.locators.ts"].includes("\"css=button\""));
});

test("escapes ids starting with a digit and finds them uniquely", () => {
  const el = inventory.elements.find(e => e.attributes.id === "123abc");
  const css = el.candidates.find(c => c.strategy === "id" && c.kind === "css");
  assert.equal(css.selector, "#\\31 23abc");
  assert.equal(css.playwrightStatus, "unique");
});

test("CSS strings with newlines match", () => {
  const el = inventory.elements.find(e => e.attributes["aria-label"]?.includes("line1"));
  const css = el.candidates.find(c => c.strategy === "aria-label" && c.kind === "css");
  assert.equal(css.playwrightStatus, "unique");
});

test("SVG XPath uses local-name() and matches", () => {
  const el = inventory.elements.find(e => e.tagName === "svg");
  const xp = el.candidates.find(c => c.kind === "xpath" && c.strategy === "aria-label");
  assert.match(xp.selector, /local-name\(\)='svg'/);
  assert.equal(xp.playwrightStatus, "unique");
});

test("auto-generated ids are not preferred; labels and other test-id conventions are used", () => {
  const email = inventory.elements.find(e => e.attributes.id === "mat-input-7");
  assert.equal(bestUniqueCandidate(email, "playwright").strategy, "placeholder");
  assert.equal(email.candidates.find(c => c.strategy === "id").stability, "fragile");

  const zip = inventory.elements.find(e => e.label?.text === "Zip code");
  assert.equal(bestUniqueCandidate(zip, "playwright").strategy, "label");

  const hook = inventory.elements.find(e => e.attributes["data-test"] === "qa-hook");
  assert.equal(bestUniqueCandidate(hook, "playwright").strategy, "data-test");
  assert.equal(hook.attributes["data-session-token"], undefined);
});

test("radio buttons in one group are told apart by value", () => {
  const radios = inventory.elements.filter(e => e.elementType === "radio");
  const chosen = radios.map(r => bestUniqueCandidate(r, "playwright"));
  assert.ok(chosen.every(c => c?.strategy === "name+value"));
});

test("elements only reachable by position are exported as fragile and listed in review.md", () => {
  const ones = inventory.elements.filter(e => e.tagName === "a" && e.text === "One");
  assert.equal(ones.length, 2);
  for (const el of ones) {
    const chosen = bestUniqueCandidate(el, "playwright");
    assert.equal(chosen.stability, "fragile");
  }
  assert.match(files["review.md"], /Only a fragile locator available/);
  assert.match(files["review.md"], /One/);
});

test("every exported Playwright locator really matches exactly one element", async () => {
  const mod = files["playwright.locators.ts"];
  const selectors = [...mod.matchAll(/^\s+[\w"$]+: ("(?:[^"\\]|\\.)*"),$/gm)].map(m => JSON.parse(m[1]));
  assert.ok(selectors.length >= 15, `only ${selectors.length} exported`);
  for (const selector of selectors) {
    assert.equal(await page.locator(selector).count(), 1, selector);
  }
});

test("batched Selenium count script returns the same counts as Playwright on the same DOM", async () => {
  const candidates = inventory.elements.flatMap(e => e.candidates);
  const counts = await page.evaluate(
    ({ script, list }) => new Function(script).call(null, list),
    { script: COUNT_SCRIPT, list: candidates.map(c => [c.kind, c.selector]) }
  );
  candidates.forEach((c, i) => assert.equal(counts[i], c.playwrightCount, c.selector));
});

test("session copy commands recreate cookies (incl. HttpOnly) and storage in a fresh Chrome", async () => {
  const { cookies, seedScript } = await buildStateCopyCommands(context, page);
  assert.ok(cookies.some(c => c.name === "lf_session" && c.httpOnly === true));
  assert.ok(seedScript);

  // Apply the exact same DevTools commands Selenium sends, in a separate, empty browser context.
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  const cdp = await fresh.newCDPSession(freshPage);
  await cdp.send("Network.setCookies", { cookies });
  await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: seedScript });
  await freshPage.goto(`${server.baseUrl}/blank.html`);
  const state = await freshPage.evaluate(() => ({ local: localStorage.getItem("lf_local"), session: sessionStorage.getItem("lf_session_store") }));
  assert.deepEqual(state, { local: "LOCAL-VAL-77", session: "SESSION-VAL-88" });
  assert.ok((await fresh.cookies()).some(c => c.name === "lf_session" && c.value === "abc123"));
  await fresh.close();
});

test("Selenium either validates or reports its failure clearly", () => {
  if (inventory.selenium.status === "ok") {
    const differences = inventory.elements.flatMap(e => e.candidates).filter(c => c.seleniumCount !== c.playwrightCount);
    assert.equal(differences.length, 0);
  } else {
    assert.equal(inventory.selenium.status, "failed");
    assert.ok(inventory.selenium.message && inventory.selenium.message.length > 0);
    assert.match(files["review.md"], /Selenium validation: failed/);
    assert.match(files["selenium.locators.ts"], /\(0 of \d+\)/);
  }
});

test("generated locator files type-check", async () => {
  const tsconfig = path.join(saved.folder, "tsconfig.check.json");
  await writeFile(tsconfig, JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", skipLibCheck: true,
      typeRoots: [path.join(projectRoot, "node_modules/@types")], baseUrl: projectRoot, paths: { "selenium-webdriver": [path.join(projectRoot, "node_modules/@types/selenium-webdriver")] } },
    files: ["playwright.locators.ts", "selenium.locators.ts"]
  }));
  execFileSync(process.execPath, [path.join(projectRoot, "node_modules/typescript/bin/tsc"), "-p", tsconfig], { stdio: "pipe" });
});

test("scan and Playwright validation of a 2,000-element page finish quickly", async () => {
  const bigPage = await context.newPage();
  await bigPage.goto(`${server.baseUrl}/big.html`);
  const started = Date.now();
  const big = await scanDom(bigPage);
  await validateWithPlaywright(bigPage, big);
  const ms = Date.now() - started;
  await bigPage.close();
  // Rows are 500 x (input + button); the 500 <span>s and wrapper <div>s are not scanned.
  assert.equal(big.elements.length, 1000);
  assert.ok(ms < 15_000, `took ${ms} ms`);
  console.log(`  big page: ${big.elements.length} elements, ${big.elements.reduce((s, e) => s + e.candidates.length, 0)} candidates, ${ms} ms`);
});
