# Fixing Cloudflare deployment

This repository is a **Cloudflare Pages** project (including Pages Functions in `functions/`), not a standalone Worker deployment. The error `Could not detect a directory containing static files` is caused by running `npx wrangler deploy`, which is the Workers deploy command and has no static asset directory configured.

## Cloudflare Pages Git integration (recommended)

In the Pages project's **Settings → Builds & deployments → Build configurations**, set:

- Framework preset: **None**
- Build command: leave blank (or `exit 0` if the dashboard requires a command)
- Build output directory: `.`
- Root directory: `/`

Then save and trigger a new deployment. Do **not** use `npx wrangler deploy` as a Pages deployment command. The repository's `wrangler.toml` declares `pages_build_output_dir = "."` for Wrangler compatibility.

## Deploy manually with Wrangler

From the repository root, run:

```sh
npx wrangler pages deploy . --project-name=hnd-attendance-dashboard
```

The Pages project must already exist and have the Google service account email, private key, and session secret configured as encrypted environment secrets. See `README.md` for Google Sheets setup.

If you intentionally created a **Workers** project instead of Pages, switch to/create a Pages project: this app's `functions/` directory uses the Pages Functions `onRequest` API.
