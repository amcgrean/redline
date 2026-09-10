# Deploying

Redline is a static single-page app: `pnpm build` produces `apps/web/dist` and nothing else is
needed at runtime. Every document, autosave and recent stays in the user's browser. Hosting on
https also enables in-place Save (File System Access API) in Chrome and Edge.

## Cloudflare Pages (recommended: free, fast, no config)

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → `amcgrean/redline`.
2. Build settings:
   - Framework preset: **None**
   - Build command: `pnpm build`
   - Build output directory: `apps/web/dist`
   - Environment variable: `NODE_VERSION` = `22`
3. Save and deploy. Every push to `main` redeploys; pull requests get preview URLs.

pnpm is picked up from `packageManager` in `package.json`; `apps/web/public/_headers` sets
long-cache headers on hashed assets.

## Vercel

Import the GitHub repo; `vercel.json` at the repo root already sets the install/build commands
and the output directory. Node 22 comes from `.node-version`.

## Notes

- `?fixture=<name>` and the `fixtures/out/browser/` mirror are dev-server only; they do nothing
  in a hosted build.
- No secrets, no environment variables beyond `NODE_VERSION`.
