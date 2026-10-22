import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { setTestEnv, testDir } from "./helpers.mjs";

setTestEnv();
const { cssEscape, cssString, xpathLiteral, isDynamicValue, stableClasses, assignKeys } = await import("../dist/locatorStrategy.js");
const { pageFolderName } = await import("../dist/exporters.js");
const { sanitizePageUrl } = await import("../dist/scanner.js");
const { resolveUploadPath } = await import("../dist/uploads.js");
const { parseSelector } = await import("../dist/selectors.js");

test("cssEscape escapes ids that start with a digit or contain special characters", () => {
  assert.equal(cssEscape("123abc"), "\\31 23abc");
  assert.equal(cssEscape("-1x"), "-\\31 x");
  assert.equal(cssEscape("a.b:c"), "a\\.b\\:c");
  assert.equal(cssEscape("login-button"), "login-button");
});

test("cssString uses CSS escapes, not JSON escapes", () => {
  assert.equal(cssString("line1\nline2"), "\"line1\\a line2\"");
  assert.equal(cssString("say \"hi\""), "\"say \\\"hi\\\"\"");
  assert.equal(cssString("back\\slash"), "\"back\\\\slash\"");
});

test("xpathLiteral handles both quote types", () => {
  assert.equal(xpathLiteral("plain"), "'plain'");
  assert.equal(xpathLiteral("it's"), "\"it's\"");
  assert.equal(xpathLiteral("'"), "\"'\"");
  assert.equal(xpathLiteral("a'b\"c"), "concat('a', \"'\", 'b\"c')");
});

test("isDynamicValue flags framework-generated ids but not readable ones", () => {
  for (const v of ["mat-input-7", "ember123", ":r1:", "«r2»", "react-select-3-input", "550e8400-e29b-41d4-a716-446655440000", "field_1697040000", "b12"]) {
    assert.equal(isDynamicValue(v), true, v);
  }
  for (const v of ["login-button", "email", "submitOrder", "facade", "main-nav", "step-two"]) {
    assert.equal(isDynamicValue(v), false, v);
  }
});

test("stableClasses drops state, CSS-in-JS and CSS-module classes", () => {
  assert.deepEqual(stableClasses("footer-link Button_root__3xYz1 active css-1x2y3z ng-touched is-open primary"), ["footer-link", "primary"]);
});

test("pageFolderName includes host, full path and hash route", () => {
  assert.equal(pageFolderName("https://www.example.com/"), "www-example-com");
  assert.equal(pageFolderName("https://app.example.com/admin/list"), "app-example-com_admin_list");
  assert.equal(pageFolderName("https://app.example.com/users/list"), "app-example-com_users_list");
  assert.equal(pageFolderName("https://app.example.com/#/dashboard"), "app-example-com_dashboard");
  assert.equal(pageFolderName("https://rahulshettyacademy.com/AutomationPractice/"), "rahulshettyacademy-com_automationpractice");
  assert.equal(pageFolderName("http://127.0.0.1:8080/x"), "127-0-0-1-8080_x");
  assert.ok(pageFolderName(`https://a.com/${"x".repeat(300)}`).length <= 120);
});

test("sanitizePageUrl removes query strings and non-route fragments", () => {
  assert.equal(sanitizePageUrl("https://a.com/reset?token=abc#section"), "https://a.com/reset");
  assert.equal(sanitizePageUrl("https://a.com/#/orders?id=5"), "https://a.com/#/orders");
});

test("assignKeys keeps keys unique", () => {
  const base = { tagName: "button", isSvg: false, elementType: null, label: null, redactedAttributes: [], strippedUrlAttributes: [], anchor: null, tagPosition: 1, visibleAtScan: true, attributes: {} };
  const keys = assignKeys([
    { ...base, index: 0, text: "Save" },
    { ...base, index: 1, text: "Save" },
    { ...base, index: 2, text: "Save" },
    { ...base, index: 3, text: "", attributes: { id: "save-button" } }
  ]);
  assert.deepEqual(keys, ["save_button", "save_button_2", "save_button_3", "save_button_4"]);
});

test("resolveUploadPath only allows files inside UPLOAD_DIR", () => {
  const dir = path.join(testDir, "fixtures");
  assert.equal(resolveUploadPath("sample-upload.txt", dir), path.join(dir, "sample-upload.txt"));
  assert.throws(() => resolveUploadPath("../../package.json", dir), /refused/);
  // On Windows "/etc/passwd" resolves to <drive>:\etc\passwd, which doesn't exist, so it is rejected as "not found".
  assert.throws(() => resolveUploadPath("/etc/passwd", dir), /refused|not found/);
  assert.throws(() => resolveUploadPath("missing.txt", dir), /not found/);
});

test("parseSelector recognises css, xpath= and bare XPath", () => {
  assert.deepEqual(parseSelector("#a"), { kind: "css", value: "#a" });
  assert.deepEqual(parseSelector("xpath=//a"), { kind: "xpath", value: "//a" });
  assert.deepEqual(parseSelector("//a"), { kind: "xpath", value: "//a" });
  assert.deepEqual(parseSelector("(//a)[2]"), { kind: "xpath", value: "(//a)[2]" });
});
