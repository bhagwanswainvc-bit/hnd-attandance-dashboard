# H & D Logistics Attendance Dashboard — Cloudflare Pages + Google Sheets

The Cloudflare Pages site uses the existing Google spreadsheet as its source of truth. Employee changes, attendance marking, and separations are written to the linked spreadsheet; attendance summaries and reports are read from it. The spreadsheet ID is configured in `functions/api/[[path]].js`.

## Google Sheet setup

The service account used by the Pages Function must have **Editor** access to the existing spreadsheet: https://docs.google.com/spreadsheets/d/1Ds8JNQbyOOYh4Gmw7jN_f9MN3yCV0OyOLyIsnmEqntk/edit?gid=0#gid=0

Create these tabs (exact names) and headers in row 1:

- `Employees`: `EmployeeID`, `Full Name`, `Designation`, `Joining Date`, `Contact`, `Email`, `Password`
- `Attendance`: `Date`, `EmployeeID`, `Status`
- `Holidays`: `Date`, `Holiday Name`

Existing employee rows from the Apps Script version are compatible. Login accepts either the Employee ID or email and matches the password in the Employees tab. Keep the spreadsheet private and share it only with trusted administrators and the service account. Do not put Google credentials in `index.html`.

## Deploy

1. In Google Cloud, enable the Google Sheets API and create a service account. Create a JSON key, then share the spreadsheet with the service account's `client_email` as an Editor.
2. In Cloudflare, create a **Pages** project from this repository and use the repository root as the build output directory. No build command is needed. Pages Functions under `functions/` provide `/api/*`.
3. In the Pages project's **Settings → Variables and Secrets**, add these as encrypted secrets (production and preview as appropriate):
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: service account `client_email`.
   - `GOOGLE_PRIVATE_KEY`: service account `private_key` from the downloaded JSON. Paste the complete PEM including BEGIN/END lines; literal `\n` is supported.
   - `SESSION_SECRET`: a randomly generated secret with at least 32 characters. Example generation: `openssl rand -base64 48`.
4. Redeploy after adding secrets. Open the Pages URL and sign in with a row in `Employees`.

The API issues a 12-hour signed session token and never returns the password column. The existing Employees sheet stores plaintext passwords for compatibility with the current Apps Script project; restrict sheet access and plan a password-hash migration before using this for sensitive or public-facing data. For production, also configure Cloudflare rate limiting/WAF on `/api/login` and use HTTPS (Pages provides this).

## Features

Login, monthly charts, bulk same-day attendance, monthly employee/date pivot, employee registration and removal, Sunday/holiday calendar highlights, and CSV/Excel-compatible report export. Holidays are displayed from rows in the `Holidays` tab.
