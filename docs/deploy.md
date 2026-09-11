# Deploying

Redline is a static single-page app: `pnpm build` produces `apps/web/dist` and nothing else is
needed at runtime. Every document, autosave and recent stays in the user's browser. Hosting on
https also enables in-place Save (File System Access API) in Chrome and Edge.

## Cloudflare Pages via GitHub Actions (the configured path)

`.github/workflows/deploy.yml` builds and uploads `apps/web/dist` to the Pages project
`redline` after every green CI run on `main` (and on manual dispatch). It creates the project on
first use. One-time setup, done by the repo owner in the Cloudflare dashboard:

1. **Account ID**: Cloudflare dashboard → Workers & Pages → the right-hand sidebar shows
   "Account ID" (or any zone's Overview page). Copy it.
2. **API token**: dashboard → My Profile → API Tokens → Create Token → template
   **"Edit Cloudflare Workers"** (it includes Pages), or a custom token with permission
   `Account · Cloudflare Pages · Edit`. Copy the token once; it is not shown again.
3. GitHub → `amcgrean/redline` → Settings → Secrets and variables → Actions → New repository
   secret, twice:
   - `CLOUDFLARE_ACCOUNT_ID` = the account id
   - `CLOUDFLARE_API_TOKEN` = the token
4. Actions → **Deploy** → Run workflow (or push to `main`). The run log prints the
   `https://redline.pages.dev` URL (or `https://<hash>.redline.pages.dev` per deploy).

Custom domain later: Pages project → Custom domains.

## Cloudflare Pages via Git integration (alternative, no secrets)

Dashboard → Workers & Pages → Create → Pages → Connect to Git → `amcgrean/redline`; framework
preset **None**, build command `pnpm build`, output directory `apps/web/dist`, environment
variable `NODE_VERSION` = `22`. If you use this, delete `.github/workflows/deploy.yml` so the two
paths do not both deploy.

## Vercel (alternative)

Import the GitHub repo; `vercel.json` at the repo root sets the install/build commands and the
output directory. Node 22 comes from `.node-version`.

## Notes

- `?fixture=<name>` and the `fixtures/out/browser/` mirror are dev-server only; they do nothing
  in a hosted build.
- pnpm is picked up from `packageManager` in `package.json`; `apps/web/public/_headers` sets
  long-cache headers on hashed assets.
