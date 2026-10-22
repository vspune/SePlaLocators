# LocatorFinder

LocatorFinder is a TypeScript MCP server that helps QA engineers find locators on a web page. It scans the page with Playwright, builds CSS and XPath candidates for every interactive element, checks each candidate in both Playwright and Selenium, and writes ready-to-use locator files for both frameworks.

The first dry-run target is the Rahul Shetty Academy Automation Practice page. You can use any other test URL you are authorised to use.

## What this version does

- Provides MCP tools for `OPEN`, `LOGIN`, `GET ALL LOCATORS`, and common browser actions.
- Scans **interactive and identifiable elements** only (links, buttons, form fields, labels, headings, images, elements with a role, test id, id, name or aria-label). Page structure such as `html`, `head`, `script`, `style` and plain wrapper `div`s is skipped.
- Builds candidates from, in order of preference: test ids, ids, names, aria-labels, `<label>` text, visible text, placeholders, alt/title, links, a nearby container with an id or test id, a parent-child locator, stable classes, and finally document position.
- Builds **parent-child locators** for every element: the locator is scoped to the nearest parent that has an `aria-label` or short visible text, for example `//a[normalize-space()='Admin']//*[local-name()='svg']` instead of `(//*[local-name()='svg'])[3]`. They rank above class and position locators, but below id, test id, name, label and the element's own text.
- Detects **auto-generated ids** (Angular Material, React `useId`, Ember, GUIDs, long numbers…) and ranks them as fragile.
- Counts matches for every candidate in Playwright and in a separate headless Selenium session that **reuses the Playwright login** (cookies and storage), so it does not log in twice.
- Writes **only locators that match exactly one element** to the generated files. Everything else is listed in `review.md`.
- **Redacts sensitive data**: hidden inputs, prefilled field values, token-like attribute values, URL query strings, cookies and script contents are never written to disk.

## Requirements

- Node.js 20 or newer
- VS Code (or another MCP-compatible AI client)
- Google Chrome installed (for Selenium validation)

Selenium Manager finds or downloads a ChromeDriver that matches your Chrome on first use. This needs network access. If your network blocks it, set `CHROMEDRIVER_PATH`, or set `SELENIUM_VALIDATION=false` to use Playwright only.

## Setup in VS Code

1. Extract the ZIP and open the `LocatorFinder` folder in VS Code.
2. Copy `.env.example` to `.env` in the same folder.
3. Set `APP_URL`. Add login settings only for an application you are authorised to test. Setting `ALLOWED_HOSTS` is recommended.
4. In the VS Code terminal, run:

   ```bash
   npm install
   npx playwright install chromium
   npm run build
   npm test        # optional: runs the unit and end-to-end tests
   ```

5. Register the server with your MCP client. In VS Code, add `.vscode/mcp.json`:

   ```json
   {
     "servers": {
       "locatorfinder": {
         "type": "stdio",
         "command": "node",
         "args": ["/absolute/path/to/LocatorFinder/dist/mcpServer.js"]
       }
     }
   }
   ```

   Other clients use a similar `command` + `args` entry. You can also run `npm start` to check that the server starts.

The server always reads `.env` and writes `locators/` relative to the LocatorFinder folder, not the folder your client starts it from.

## Run it with GitHub Copilot (VS Code)

GitHub Copilot uses the same `.vscode/mcp.json` shown above, so no separate setup is needed.

1. **Requirements:** a recent VS Code with the GitHub Copilot and Copilot Chat extensions, signed in. If Copilot comes from an organisation, MCP servers must be allowed by its policy.
2. **Build the server:** run `npm install`, `npx playwright install chromium` and `npm run build`. Save `.env` (see "Login configuration").
3. **Rebuild after code changes:** run `npm run build` again whenever you change anything in `src/`. The server runs the built files in `dist/`, so it will not see your changes until you rebuild and restart it.
4. **Start the MCP server first, before running any prompt:** open `.vscode/mcp.json` and click **Start** above `locatorfinder`, or press `Ctrl+Shift+P`, run **MCP: List Servers**, pick `locatorfinder` and choose **Start**. The label above `locatorfinder` should change to **Running**. If it says **Error**, see the troubleshooting note below.
5. **Use Agent mode:** in Copilot Chat, switch the mode dropdown from Ask to **Agent**. MCP tools only work in Agent mode.
6. **Check the tools:** click the tools icon in the chat box. `locatorfinder` and its tools should be listed and ticked.
7. **Run the prompts** one message at a time (see [examples/locator-prompts.md](examples/locator-prompts.md)).
8. **Approve tool calls:** Copilot asks permission the first time each tool runs. Click **Allow**.
9. **Check the output** in the per-page folders under `locators/`.

If the tools do not appear, press `Ctrl+Shift+P`, run **MCP: List Servers**, select `locatorfinder` and choose **Show Output** (or open the Output panel with `Ctrl+Shift+U` and pick **MCP: locatorfinder**). A wrong path in `mcp.json`, a missing build or an unsaved `.env` shows up there.

**Server shows "Error" and the output is empty (Windows):** VS Code may not find `node` on its PATH, so the process never starts. In `.vscode/mcp.json`, replace `"command": "node"` with the full path, for example `"command": "C:\\Program Files\\nodejs\\node.exe"`. Then close VS Code completely, reopen it and click **Start** again.

## Vibe / MCP tools

- `open_url`: opens a URL in the Playwright-controlled browser (only hosts in `ALLOWED_HOSTS`, when set).
- `login`: performs the login flow configured in `.env`. Never asks for or prints the password.
- `get_all_locators`: scans the current page, validates every candidate in both frameworks and saves the output. The reply includes counts, Selenium status and any warnings.
- `perform_action`: click, dblclick, rightclick, fill, clear, select, check, uncheck, hover, press, scroll, upload. Uploads are limited to files inside `UPLOAD_DIR`.

Example instructions for your AI client:

- "Open the Automation Practice page."
- "Get all locators on the current page."
- "Login using the configured test account, wait 5 seconds, then get all locators." (`get_all_locators` takes an optional `waitSeconds`, 0 to 30, so a page that has just loaded after login can finish rendering before the scan.)
- "Click the element matching CSS selector `#someButton`."
- "Select option `India` from the native select matching `select#country`."

Tool calls run one at a time, so a scan is never interleaved with a click.

## Login configuration

Set these in `.env`:

- `LOGIN_URL` (optional; `APP_URL` is used if omitted)
- `APP_USERNAME`, `APP_PASSWORD`
- `LOGIN_USERNAME_SELECTOR`, `LOGIN_PASSWORD_SELECTOR`, `LOGIN_SUBMIT_SELECTOR`
- `LOGIN_SUCCESS_SELECTOR` (optional but recommended; login waits for it)

Selectors can be CSS or XPath (prefix with `xpath=`, or start with `//`). The generic flow may need adjusting for MFA, CAPTCHA, SSO or multi-step logins. If you log in by hand in a visible browser (`HEADLESS=false`), the default `SELENIUM_AUTH=copy` still lets Selenium see the logged-in page.

Never commit `.env`. Use a dedicated test account.

### Example: log in, then identify the locators (OrangeHRM demo)

1. In `.env`:

   ```text
   APP_URL=https://opensource-demo.orangehrmlive.com/web/index.php/auth/login
   LOGIN_URL=https://opensource-demo.orangehrmlive.com/web/index.php/auth/login
   APP_USERNAME=<your username>
   APP_PASSWORD=<your password>
   ALLOWED_HOSTS=opensource-demo.orangehrmlive.com
   LOGIN_USERNAME_SELECTOR=input[name="username"]
   LOGIN_PASSWORD_SELECTOR=input[name="password"]
   LOGIN_SUBMIT_SELECTOR=button[type="submit"]
   ```

   The three `LOGIN_*_SELECTOR` lines are required: without them the `login` tool fails with "Login is not configured".

2. Prompts for your AI client (the password is read from `.env`, never typed in the prompt):

   1. "Open https://opensource-demo.orangehrmlive.com/web/index.php/auth/login"
   2. "Get all locators on the current page." (login page, before signing in)
   3. "Log in using APP_USERNAME and APP_PASSWORD from .env. Once logged in, identify all locators on the page you land on."
   4. "Summarize how many elements have a unique locator in Playwright and Selenium, and where the files were saved."

3. Each page gets its own folder under `locators/`, for example `opensource-demo-orangehrmlive-com_web_index-php_auth_login` and `opensource-demo-orangehrmlive-com_web_index-php_dashboard_index`. Only locators that match exactly one element are written. The password is never written to the output files.

More prompt wording is in [examples/locator-prompts.md](examples/locator-prompts.md).

## Output structure

Each scan creates one folder per page, named from host + path (+ hash route), so pages never overwrite each other:

```text
locators/
  rahulshettyacademy-com_automationpractice/
    locator-inventory.json   every element and candidate with Playwright/Selenium counts
    playwright.locators.ts   unique Playwright locators
    selenium.locators.ts     unique Selenium locators (By.css / By.xpath)
    review.md                what needs a human: no unique locator, fragile-only, framework differences, warnings
```

Example generated entries:

```ts
export const playwrightLocators = {
  /** button[type=submit] "Login" · text · good · PW 1 / SE 1 */
  login_button: "xpath=//button[normalize-space()='Login']",
  /** input "Email" · placeholder · good · PW 1 / SE 1 */
  email_input: "css=input[placeholder=\"Email\"]",
} as const;

// usage
await page.locator(playwrightLocators.login_button).click();
```

```ts
import { By } from "selenium-webdriver";
export const seleniumLocators = {
  login_button: By.xpath("//button[normalize-space()='Login']"),
} satisfies Record<string, By>;

// usage
await driver.findElement(seleniumLocators.login_button).click();
```

Each entry's comment shows the strategy, a stability rating (`stable`, `good`, `fragile`) and the match count in each framework. Entries marked **fragile** (position-based, class-based, or auto-generated ids) are included because they are unique today, but review them before relying on them, or ask developers for a test id.

Generated folders are ignored by Git. Review them before sharing.

## Locator discovery and validation notes

- Only the current DOM is scanned. Menus, dialogs and lazy-loaded content must be opened first (use `perform_action`), then scan again.
- Elements inside iframes and shadow DOM are not scanned yet. The scan reports how many iframes and open shadow roots it found.
- Selenium validation runs in its own headless Chrome. By default it copies the Playwright cookies and storage and loads the same URL. State that lives only in the page (an opened modal, typed text) is not copied, so those counts can differ. Differences are listed in `review.md`.
- Selenium counts are taken in one batched script per 500 selectors (the same `querySelectorAll` / `document.evaluate` calls WebDriver uses), with a spot-check against real `findElements`. This keeps a 2,000-element scan within MCP client time limits.
- A locator that is unique today can still break after application changes.
- `select` supports native HTML `<select>` controls only.
- The action tool does not perform assertions.

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `APP_URL` | Automation Practice page | Default target / login entry point |
| `ALLOWED_HOSTS` | (any) | Comma-separated hosts the browser may open or navigate to; `*.example.com` supported |
| `UPLOAD_DIR` | `fixtures` | Only folder `upload` may read from |
| `LOCATORS_DIR` | `locators` | Output folder |
| `MAX_ELEMENTS` | `2000` | Elements per scan |
| `TEST_ID_ATTRIBUTES` | `data-testid,data-test-id,data-test,data-qa,data-cy,data-automation-id,data-pw` | Test-id conventions, highest priority first |
| `HEADLESS` | `true` | `false` shows the Playwright browser |
| `SELENIUM_VALIDATION` | `true` | `false` skips Selenium |
| `SELENIUM_HEADLESS` | `true` | `false` shows the Selenium Chrome window |
| `SELENIUM_AUTH` | `copy` | `copy`, `login` or `none` |
| `CHROME_BINARY`, `CHROMEDRIVER_PATH` | (auto) | Override the browser/driver Selenium uses |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | (bundled) | Use a specific Chromium for Playwright |

## Public repository and proprietary logic

Do not commit credentials, customer DOM snapshots, generated locator inventories, upload fixtures or private implementation files.

The `src/private-core/` directory is Git-ignored and is not compiled. If you add proprietary logic, keep a private backup or move it into a private package or service before publishing. `.gitignore` only protects Git: it does not stop the folder from being included when you zip and share the project. A `.gitignore` rule is also not a substitute for checking `git status` and reviewing staged files.

### Core files are not in the public repository

The locator discovery and ranking logic, `src/locatorStrategy.ts` and `src/scanner.ts`, is intentionally **not pushed** to the public repository. The server imports both files, so a fresh clone **will not build** until they are supplied. The public repository shows the setup, the MCP tools, the prompts and the sample output only. Contact the author for access to the core.

## Commands

- `npm run build`: compile TypeScript
- `npm start`: start the MCP server
- `npm run typecheck`: type-check without emitting output
- `npm test`: build, then run unit tests, a fixture-page scan and an MCP end-to-end test

## Security

- Only scan applications you are authorised to test, and set `ALLOWED_HOSTS` for client applications.
- Uploads are restricted to `UPLOAD_DIR` so a web page cannot trick the AI client into uploading local files such as SSH keys or `.env`.
- Generated files never contain hidden-input values, prefilled field values, token-like values, URL query strings, cookies or script source. Visible page text (button labels, headings) is kept because locators need it.
- Do not commit `.env`. If a secret is ever committed, rotate it: removing the file in a later commit does not invalidate the leaked secret.
