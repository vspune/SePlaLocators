/**
 * Shared helpers for user-supplied selectors (from .env or perform_action).
 * Accepted forms: plain CSS, "css=<css>", "xpath=<xpath>", or a bare XPath starting with "/" or "(".
 */
export interface ParsedSelector {
  kind: "css" | "xpath";
  value: string;
}

export function parseSelector(raw: string): ParsedSelector {
  const selector = raw.trim();
  if (selector.startsWith("xpath=")) return { kind: "xpath", value: selector.slice("xpath=".length) };
  if (selector.startsWith("css=")) return { kind: "css", value: selector.slice("css=".length) };
  if (selector.startsWith("/") || selector.startsWith("(")) return { kind: "xpath", value: selector };
  return { kind: "css", value: selector };
}

/** Playwright selector string that is unambiguous about the engine. */
export function toPlaywrightSelector(raw: string): string {
  const parsed = parseSelector(raw);
  return parsed.kind === "xpath" ? `xpath=${parsed.value}` : `css=${parsed.value}`;
}
