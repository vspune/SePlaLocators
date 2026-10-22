import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { assertUrlAllowed, config, hostIsAllowed, loginIsConfigured } from "./config.js";
import { toPlaywrightSelector } from "./selectors.js";

let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;

async function getContext(): Promise<BrowserContext> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: config.headless,
      ...(config.playwrightExecutable ? { executablePath: config.playwrightExecutable } : {})
    });
    context = undefined;
  }
  if (!context) {
    context = await browser.newContext();
    if (config.allowedHosts.length > 0) {
      // Enforce ALLOWED_HOSTS for navigations triggered by clicks/redirects too, not only open_url.
      await context.route("**/*", route => {
        const request = route.request();
        if (request.isNavigationRequest()) {
          let host = "";
          try { host = new URL(request.url()).hostname; } catch { /* non-URL, let it through */ }
          if (host && !hostIsAllowed(host)) {
            console.error(`[LocatorFinder] Blocked navigation to non-allowed host: ${host}`);
            return route.abort("blockedbyclient");
          }
        }
        return route.continue();
      });
    }
  }
  return context;
}

export async function getPage(): Promise<Page> {
  const ctx = await getContext();
  if (!page || page.isClosed()) {
    page = await ctx.newPage();
  }
  return page;
}

export async function getBrowserContext(): Promise<BrowserContext> {
  return getContext();
}

export async function openUrl(url: string): Promise<{ url: string; title: string }> {
  const target = assertUrlAllowed(url);
  const currentPage = await getPage();
  await currentPage.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
  await currentPage.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  return { url: currentPage.url(), title: await currentPage.title() };
}

export async function login(): Promise<{ url: string; title: string; message: string }> {
  if (!loginIsConfigured()) {
    throw new Error(
      "Login is not configured. Set APP_USERNAME, APP_PASSWORD, LOGIN_USERNAME_SELECTOR, LOGIN_PASSWORD_SELECTOR, and LOGIN_SUBMIT_SELECTOR in the project's .env."
    );
  }

  const currentPage = await getPage();
  const entryUrl = assertUrlAllowed(config.loginUrl ?? config.appUrl).toString();
  await currentPage.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });

  await currentPage.locator(toPlaywrightSelector(config.usernameSelector!)).fill(config.username!, { timeout: 15_000 });
  await currentPage.locator(toPlaywrightSelector(config.passwordSelector!)).fill(config.password!, { timeout: 15_000 });
  await currentPage.locator(toPlaywrightSelector(config.submitSelector!)).click({ timeout: 15_000 });

  if (config.successSelector) {
    await currentPage.locator(toPlaywrightSelector(config.successSelector)).waitFor({ state: "visible", timeout: 20_000 });
  } else {
    await currentPage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    await currentPage.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  }

  return {
    url: currentPage.url(),
    title: await currentPage.title(),
    message: config.successSelector
      ? "Login flow completed and LOGIN_SUCCESS_SELECTOR is visible."
      : "Login flow completed. LOGIN_SUCCESS_SELECTOR is not set, so verify the page is the expected authenticated state before scanning."
  };
}

export async function closeBrowser(): Promise<void> {
  if (browser) await browser.close().catch(() => undefined);
  browser = undefined;
  context = undefined;
  page = undefined;
}
