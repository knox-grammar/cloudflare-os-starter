# knox-os deployment record

Operational reference for this instance of the [Cloudflare OS Deployment
Starter](https://github.com/cloudflare/cloudflare-os-starter). See
[`.agents/skills/cloudflare-os-operator/SKILL.md`](.agents/skills/cloudflare-os-operator/SKILL.md)
before making any change described here.

## Identity

- **Account:** Knox Grammar School Enterprise, `2ddaede0fbdd479a6bf410a5f1eb76ad`
- **Route:** https://os.knoxi.dev (zone `knoxi.dev`, Worker Custom Domain on the router)
- **Access:** self-hosted app, issuer `https://knoxgrammar.cloudflareaccess.com`, audience
  `8623541e237ab1d2eee15a213ba7539c45e20f9e8f922c62aa6f78571c9fad6a`
- **Admins:** `carrickm@knox.nsw.edu.au` (see `deployment.jsonc` for the current list)

## Workers

| Worker | Role | Public route |
| --- | --- | --- |
| `knox-os` | Router, serves the frontend | `os.knoxi.dev` (only public route) |
| `knox-os-workshop` | Workshop backend | none — service binding only |
| `knox-os-context` | Context Gatekeeper | none — service binding only |
| `knox-os-scheduler` | Scheduler Gatekeeper | none — service binding only |
| `knox-os-gatekeeper` | Custom Gatekeeper | none — service binding only |
| `knox-os-error-reporter` | Error Reporter | none — service binding only |

Every Worker other than `knox-os` must always show `workers_dev: false` and
`previews_enabled: false`. A public route on any of them is an unauthenticated
bypass around the router's Access application. Verify with:

```sh
CLOUDFLARE_ACCOUNT_ID=2ddaede0fbdd479a6bf410a5f1eb76ad \
  pnpm exec wrangler deployments list --name <worker-name>
```

or the `workers/scripts/<name>/subdomain` API endpoint.

## Provisioned resources

Auto-provisioned by `pnpm deploy` on 2026-08-25 (all `null` in `deployment.jsonc`,
so Wrangler owns and remembers these):

- KV `knox-os-context-context-collections` — Context Gatekeeper collections
- KV `knox-os-workshop-blueprints` — Blueprints
- KV `knox-os-workshop-avatars` — Avatars
- R2 `knox-os-workshop-blueprint-content` — Blueprint content

Context Artifacts (Git-backed collections) is **disabled**.

## AI

AI Gateway `default`, provider `cloudflare` only (Workers AI). Reached over the
Workshop's `WORKERS_AI` binding, which is pre-authenticated in-account — no
`CF_AI_GATEWAY_API_TOKEN` is configured or needed for this provider set. Adding
`anthropic`/`openai`/`google` later changes that; see
[`docs/customization.md#ai-models`](docs/customization.md#ai-models) before
changing `aiGateway.providers`.

## Observability and error reporting

- Structured logs enabled, 100% head sampling.
- Invocation logs and traces off.
- Error Reporter private, no public route, receives only explicit
  `reportIssue()` events (not a catch-all).

## Custom Gatekeeper

Deployed but still the stock example from the starter: read-only, no
credentials, identical response to every authenticated user. **Keep it
disabled in `/admin`** until someone reviews `packages/custom-gatekeeper` and
decides what it should actually expose. Load the upstream `write-gatekeeper`
skill before customizing or enabling it for real use.

## Current version IDs (last-known-good)

Recorded after the most recent production deploy, 2026-08-26 (added
`knox-os-gatekeeper-microsoft`, no `CLIENT_ID`/`CLIENT_SECRET` installed yet
-- functionally inert):

| Worker | Version ID |
| --- | --- |
| `knox-os` | `34305362-62b9-4342-8288-5f0192b82b80` |
| `knox-os-workshop` | `116405b3-a527-45a9-a2b6-78577aa4472a` |
| `knox-os-context` | `10bfb51e-a250-42a9-9c92-bfc8d180c4f2` |
| `knox-os-scheduler` | `1afabc89-d1c0-4ecf-81ef-8b7bfe15b0fc` |
| `knox-os-gatekeeper` | `397277cc-ceff-4e95-9cdf-b6d43a978e2c` |
| `knox-os-gatekeeper-microsoft` | `03cde438-480b-4b9a-9460-cafc9530f114` |
| `knox-os-error-reporter` | `3f58f189-700e-4f38-8ae4-08694cdc6576` |

Previous (first-deploy, 2026-08-25) version IDs, kept for rollback reference:
`knox-os` `b9933012-4839-4f73-a8c0-db2439523c0d`, `knox-os-workshop`
`137a5401-b0a6-4d4e-bc11-7150b7fa5b5b`, `knox-os-context`
`b3b0e6c4-5fca-4460-8026-ecab28771503`, `knox-os-scheduler`
`d2996ddc-b1c3-4fb5-ae29-c98ffab20877`, `knox-os-gatekeeper`
`df41701d-0e64-4054-aca7-769d7f5f7a38`, `knox-os-error-reporter`
`490a1bd8-17aa-4958-8aae-35e4e871a5a6`.

**Update this table after every production deploy.** Without it, a rollback
has nothing to target. Get the current version of any Worker with:

```sh
CLOUDFLARE_ACCOUNT_ID=2ddaede0fbdd479a6bf410a5f1eb76ad \
  pnpm exec wrangler deployments list --name <worker-name>
```

## Local environment notes

- **Node 24.19+ is required.** A checkout on Node 24.18 silently rewrote
  `pnpm-lock.yaml` (downgrading TypeScript 7 → 5.9.3 and capnweb 0.11 → 0.8)
  the first time a `pnpm`/`wrangler` command ran here. If you ever see an
  unexpected `pnpm-lock.yaml` diff after just running a command, suspect the
  Node version first: `node -v`, then `fnm use 24.19.0` (or install it with
  `fnm install 24.19.0`).
- **`cloudflare-os` is its own pnpm workspace** with its own lockfile and
  `node_modules`. `pnpm install` at the repo root does not install it.
  Always run both:

  ```sh
  pnpm install
  pnpm --dir cloudflare-os install
  ```

  Skipping the second step produces a confusing `tsc` failure
  (`Unknown compiler option 'singleThreaded'`) because the submodule falls
  back to a TypeScript version too old for its own config.
- The submodule is pinned by gitlink, not by branch. Never run
  `git submodule update --remote`; use
  `git submodule update --init` to sync to the commit the repo already
  points at, and see
  [`references/upgrade-and-rollback.md`](.agents/skills/cloudflare-os-operator/references/upgrade-and-rollback.md)
  to advance it deliberately.

## Routine operations

- **Deploy a config change:** edit `deployment.jsonc`, run `pnpm check`,
  review the dry-run bindings, get approval for anything touching the trust
  boundary (see the operator skill), then `pnpm deploy`. Update the version
  ID table above afterward.
- **Only one `pnpm check`/`pnpm deploy` at a time** against this checkout.
  Use a separate worktree for concurrent work.
- **Upgrading the pinned `cloudflare-os` commit** is a distinct, higher-risk
  operation — follow
  [`references/upgrade-and-rollback.md`](.agents/skills/cloudflare-os-operator/references/upgrade-and-rollback.md)
  rather than bumping the gitlink casually.
- **Rollback** is per-Worker and not atomic. Use the version IDs above as the
  starting point and follow the same reference doc; never delete or downgrade
  storage as part of a rollback.

## Open follow-ups

- [ ] Widen the Access policy beyond `carrickm@knox.nsw.edu.au` to the
      intended user population, then re-verify with a positive and a negative
      identity.
- [ ] Review `packages/custom-gatekeeper` before enabling it for real use.
- [ ] Decide whether `.mcp.json` at the repo root should be tracked or
      gitignored.
- [ ] Add a `.nvmrc`/`.node-version` pinning `24.19.0` to prevent the
      lockfile-drift issue above from recurring for the next operator.
