import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * Project root = the folder that contains package.json.
 * MCP clients usually launch `node /abs/path/dist/mcpServer.js` from their OWN working directory,
 * so every relative path (.env, locators/, uploads) is resolved from here, never from process.cwd().
 */
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// quiet: true keeps dotenv from ever writing to stdout, which would corrupt the MCP stdio stream.
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

function resolveFromRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

function list(value: string | undefined, fallback: string[] = []): string[] {
  if (!value || value.trim() === "") return fallback;
  return value.split(",").map(v => v.trim()).filter(Boolean);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type SeleniumAuthMode = "copy" | "login" | "none";

const seleniumAuthRaw = (process.env.SELENIUM_AUTH ?? "copy").trim().toLowerCase();

export const config = {
  appUrl: process.env.APP_URL ?? "https://rahulshettyacademy.com/AutomationPractice/",
  loginUrl: process.env.LOGIN_URL || undefined,
  username: process.env.APP_USERNAME || undefined,
  password: process.env.APP_PASSWORD || undefined,
  usernameSelector: process.env.LOGIN_USERNAME_SELECTOR || undefined,
  passwordSelector: process.env.LOGIN_PASSWORD_SELECTOR || undefined,
  submitSelector: process.env.LOGIN_SUBMIT_SELECTOR || undefined,
  successSelector: process.env.LOGIN_SUCCESS_SELECTOR || undefined,

  locatorsDir: resolveFromRoot(process.env.LOCATORS_DIR ?? "locators"),
  maxElements: positiveInt(process.env.MAX_ELEMENTS, 2000),

  /** Browser */
  headless: bool(process.env.HEADLESS, true),
  /** Optional custom Chromium/Chrome binary for Playwright. */
  playwrightExecutable: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,

  /** Safety */
  /** Hostnames allowed for open_url/login and in-page navigation. Empty = allow all. Supports "*.example.com". */
  allowedHosts: list(process.env.ALLOWED_HOSTS).map(h => h.toLowerCase()),
  /** The only folder perform_action "upload" may read files from. */
  uploadDir: resolveFromRoot(process.env.UPLOAD_DIR ?? "fixtures"),

  /** Locator strategy */
  testIdAttributes: list(process.env.TEST_ID_ATTRIBUTES, [
    "data-testid", "data-test-id", "data-test", "data-qa", "data-cy", "data-automation-id", "data-pw"
  ]).map(a => a.toLowerCase()),

  /** Selenium validation */
  seleniumEnabled: bool(process.env.SELENIUM_VALIDATION, true),
  seleniumHeadless: bool(process.env.SELENIUM_HEADLESS, true),
  /** copy = reuse Playwright cookies + storage (default); login = replay configured login; none = anonymous. */
  seleniumAuth: (["copy", "login", "none"].includes(seleniumAuthRaw) ? seleniumAuthRaw : "copy") as SeleniumAuthMode,
  chromeBinary: process.env.CHROME_BINARY || undefined,
  chromeDriverPath: process.env.CHROMEDRIVER_PATH || undefined
};

export function loginIsConfigured(): boolean {
  return Boolean(
    config.username &&
    config.password &&
    config.usernameSelector &&
    config.passwordSelector &&
    config.submitSelector
  );
}

export function hostIsAllowed(hostname: string): boolean {
  if (config.allowedHosts.length === 0) return true;
  const host = hostname.toLowerCase();
  return config.allowedHosts.some(rule =>
    rule.startsWith("*.") ? host === rule.slice(2) || host.endsWith(rule.slice(1)) : host === rule
  );
}

export function assertUrlAllowed(url: string): URL {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  if (!hostIsAllowed(target.hostname)) {
    throw new Error(`Host '${target.hostname}' is not in ALLOWED_HOSTS (${config.allowedHosts.join(", ")}).`);
  }
  return target;
}
