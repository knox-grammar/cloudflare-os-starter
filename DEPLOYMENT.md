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

Recorded after the most recent production deploy, 2026-08-26 (Microsoft resource picker
UI live; Entra short-form Graph scopes normalize correctly; `CLIENT_ID` and `CLIENT_SECRET`
verified present on that Worker):

| Worker | Version ID |
| --- | --- |
| `knox-os` | `ee33dc27-242c-4159-af06-36327faccb1e` |
| `knox-os-workshop` | `8818ac8a-8058-418a-a34b-d9bf95822b4a` |
| `knox-os-context` | `4aa7da4f-f183-4da2-a204-2f2723a4144f` |
| `knox-os-scheduler` | `5290ce1c-d6fd-42b1-ac81-d4446fc48250` |
| `knox-os-gatekeeper` | `4969d141-1a36-41ca-b027-c6ce03d30415` |
| `knox-os-gatekeeper-microsoft` | `8628e484-7a2b-41cf-80fc-e034a1c67c73` |
| `knox-os-error-reporter` | `ff10b958-a5d8-4b95-9b84-d169866c1524` |

Immediate pre-scope-fix rollback targets (2026-08-26): `knox-os`
`98618561-c6fb-4ca2-8503-133269efb26b`, `knox-os-workshop`
`21f8a41c-b33d-4cea-9320-1b07af795c0c`, `knox-os-context`
`4348f3a6-134b-40d2-80c3-f37c5dfc5e02`, `knox-os-scheduler`
`f7ce0613-aaa5-437d-8d15-8cc8603b59fa`, `knox-os-gatekeeper`
`e443911a-12d9-4ee9-89cf-5b5e9db524e8`, `knox-os-gatekeeper-microsoft`
`99c4fc1d-0eb3-4a73-86ba-6736d400c5f6`, `knox-os-error-reporter`
`ae2fcc4a-09a7-4d34-861f-9ca395671e02`.

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
