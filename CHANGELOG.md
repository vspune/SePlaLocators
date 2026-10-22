# Changelog

## 0.2.0: review fixes

### Must fix
1. **Locators matching several elements are no longer exported.** `playwright.locators.ts` / `selenium.locators.ts` contain only candidates that matched exactly one element in that framework. Everything else is listed in the new `review.md`.
2. **Scan targets the right elements.** Only interactive or identifiable elements are scanned; `html`, `head`, `script`, `style`, `meta`, hidden inputs, SVG internals and plain wrapper `div`s are skipped, so `MAX_ELEMENTS` is spent on elements tests actually use.
3. **Sensitive data is stripped before saving:** hidden inputs, prefilled `value`s, token-like values (JWTs, long random strings), attributes named like token/csrf/session/secret, URL query strings and fragments (in `href`/`src`/`action` and the page URL), and script/style text. The scan reports how many values were redacted.
4. **More locator strategies:** visible text, `<label>` association (`for` and wrapping), button `value`, alt/title, anchored-to-container, stable classes, radio/checkbox `name+value`, and position as a last resort. Test-id conventions are configurable (`data-testid`, `data-test`, `data-qa`, `data-cy`, …). SKILL.md now describes what is actually implemented.
5. **Auto-generated ids are detected** (Angular Material/CDK, React `useId`, Ember, MUI, GUIDs, long numbers, hex hashes) and ranked as fragile.
6. **Paths no longer depend on the launch folder.** `.env`, `locators/` and `fixtures/` resolve from the project folder. `dotenv` runs with `quiet: true` so it can never write to the MCP stdout stream. Lockfile added.

### Should fix
7. **Faster validation.** Playwright counts run concurrently (about 4 s for 4,500 candidates, down from about 10 s for 5,000). Selenium counts are batched 500 per script call instead of one WebDriver call each, with a findElements spot-check.
8. **Escaping bugs fixed:** ids starting with a digit (`#\31 23abc`), CSS strings with newlines (CSS hex escapes instead of JSON), XPath literals that are a single quote, SVG XPath (`local-name()`).
9. **Selenium session reuses the Playwright state** (cookies including HttpOnly, localStorage, sessionStorage) via Chrome DevTools instead of logging in again. It runs headless and waits for the DOM to settle. `SELENIUM_AUTH=copy|login|none`, `SELENIUM_VALIDATION=false`, `CHROME_BINARY`, `CHROMEDRIVER_PATH`.
10. **Selenium failures and Playwright/Selenium count differences are reported** in the tool response and `review.md`.
11. **Uploads are restricted to `UPLOAD_DIR`** (blocks `../`, absolute paths and symlinks). Optional `ALLOWED_HOSTS` is enforced for `open_url`, login and in-page navigation.
12. **Collision-free page folders:** host + full path + hash route (`app-example-com_admin_list`) instead of the last path segment only; long names are truncated with a hash.

### Minor
- Removed the no-op `xpath=` ternary in `perform_action`; selectors are parsed once (`css=`, `xpath=`, bare `//`).
- The `maxElements` argument is passed into the scan instead of slicing afterwards.
- `visibleAtScan` uses `checkVisibility()` and is shown in the generated comments.
- Selenium file emits `By.css(...)` / `By.xpath(...)` directly with `satisfies Record<string, By>`; both files export a key type.
- Readable keys (`login_button`, `email_input`) instead of `button_13`.
- Server shuts Chromium down when the client disconnects (stdin close), not only on signals.
- `HEADLESS` and all new settings are documented in `.env.example` and the README.
- Text is captured only for short, meaningful elements, and per element, not concatenated from the whole page.
- Migrated from deprecated `server.tool` to `registerTool`; tool calls are serialised.
- Added tests: unit tests, a fixture-page scan, and an MCP end-to-end test (`npm test`).
