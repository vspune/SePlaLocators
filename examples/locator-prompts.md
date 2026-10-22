# LocatorFinder Vibe Prompt Examples

Use these with an MCP-compatible AI client after configuring LocatorFinder.

## Public page

1. "Open https://rahulshettyacademy.com/AutomationPractice/"
2. "Get all locators on the current page."
3. "Summarize how many elements have a unique locator in Playwright and Selenium, and where the files were saved."
4. "Which elements in review.md have no unique locator?"

## Authenticated page

1. Configure the login URL, `APP_USERNAME`, `APP_PASSWORD` and (if needed) selectors in the project's `.env`.
2. "Open the application URL."
3. "Log in using APP_USERNAME and APP_PASSWORD from .env. Once logged in, wait 5 seconds, then identify all locators on the page you land on."
4. "Summarize how many elements have a unique locator in Playwright and Selenium, and save them in a separate file set for this page (for example `locators/orangehrm/dashboard-page.*`)."

Example (OrangeHRM demo): set `APP_URL` and `LOGIN_URL` to `https://opensource-demo.orangehrmlive.com/web/index.php/auth/login`, then use the prompts above. The password is read from `.env` and is never typed in the prompt or written to the output files.

## Elements that only appear after an interaction

1. "Click `xpath=//button[normalize-space()='Open menu']`."
2. "Get all locators again." (The menu items are now in the DOM.)

## Common actions

- "Click the element matching CSS selector `#someButton`."
- "Fill `input[name='email']` with qa.tester@example.com."
- "Select `India` from native select `select#country`."
- "Hover over `.products-menu`."
- "Press Enter on `input[name='search']`."
- "Upload `sample-upload.txt` into `input[type='file']`." (The file must be in the upload folder, `fixtures/` by default.)
- "Get all locators again after the page changes."

Avoid putting passwords, tokens or real customer data in prompts.
