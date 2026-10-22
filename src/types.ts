export type LocatorKind = "css" | "xpath";
export type ValidationStatus = "unique" | "multiple" | "zero" | "error" | "not-run";
/** stable = test id / clean id / name; good = user-facing attribute or text; fragile = may break on UI change. */
export type Stability = "stable" | "good" | "fragile";

export interface LocatorCandidate {
  kind: LocatorKind;
  selector: string;
  strategy: string;
  stability: Stability;
  /** Lower is preferred when several candidates are unique. */
  rank: number;
  note?: string;
  playwrightCount: number | null;
  seleniumCount: number | null;
  playwrightStatus: ValidationStatus;
  seleniumStatus: ValidationStatus;
}

export interface LabelInfo {
  /** First non-empty direct text node of the label, whitespace-normalised like XPath normalize-space(). */
  text: string;
  /** "for" = <label for="id">, "wrap" = field nested inside the <label>. */
  source: "for" | "wrap";
}

export interface AnchorInfo {
  attr: string;
  value: string;
}

/** Nearest ancestor with a user-facing handle (aria-label or short visible text), used for parent > child locators. */
export interface ParentInfo {
  tagName: string;
  isSvg: boolean;
  /** "aria-label" matches @aria-label; "text" matches normalize-space() of the whole parent. */
  by: "aria-label" | "text";
  value: string;
}

/** Raw element data collected in the page, before candidates are built. */
export interface ScannedElement {
  index: number;
  tagName: string;
  isSvg: boolean;
  elementType: string | null;
  /** Normalised text content (only when short and meaningful; empty otherwise). */
  text: string;
  label: LabelInfo | null;
  /** Sanitised attributes: event handlers, styles, secrets and URL query strings removed. */
  attributes: Record<string, string>;
  /** Attribute names whose values were removed because they looked sensitive. */
  redactedAttributes: string[];
  /** Attribute names (href/src/action) whose query string or fragment was stripped. */
  strippedUrlAttributes: string[];
  /** Nearest ancestor with a test id or stable id, used for anchored locators. */
  anchor: AnchorInfo | null;
  /** Nearest ancestor identifiable by aria-label or visible text; locators scoped to it are preferred over class/position. */
  parent?: ParentInfo | null;
  /** 1-based position among all elements with the same tag in document order, for (//tag)[n]. */
  tagPosition: number;
  visibleAtScan: boolean;
}

export interface DiscoveredElement extends ScannedElement {
  /** Readable key used in the generated locator files. */
  key: string;
  candidates: LocatorCandidate[];
}

export interface FrameworkRun {
  status: "ok" | "failed" | "skipped";
  message?: string;
  durationMs?: number;
}

export interface LocatorInventory {
  /** Page URL with query string and fragment removed (fragment kept only for hash routes). */
  pageUrl: string;
  pageTitle: string;
  scannedAt: string;
  /** Number of candidate elements on the page (after filtering to interactive/meaningful ones). */
  totalElements: number;
  truncated: boolean;
  stats: {
    iframes: number;
    openShadowHosts: number;
    redactedAttributeValues: number;
    strippedUrls: number;
  };
  playwright: FrameworkRun;
  selenium: FrameworkRun;
  warnings: string[];
  elements: DiscoveredElement[];
}
