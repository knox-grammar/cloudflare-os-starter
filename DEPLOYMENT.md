# knox-os deployment record

Operational reference for this instance of the [Cloudflare OS Deployment
Starter](https://github.com/cloudflare/cloudflare-os-starter). See
[`.agents/skills/cloudflare-os-operator/SKILL.md`](.agents/skills/cloudflare-os-operator/SKILL.md)
before making any change described here.

## Identity

- **Account:** Knox Grammar School Enterprise, `2ddaede0fbdd479a6bf410a5f1eb76ad`
- **Route:** https://os.knoxi.dev (zone `knoxi.dev`, Worker Custom Domain on the router)
- **Access:** self-hosted app "Knoxi Apps - knox-os", issuer `https://knoxgrammar.cloudflareaccess.com`, audience
  `8623541e237ab1d2eee15a213ba7539c45e20f9e8f922c62aa6f78571c9fad6a`. Its destinations are the
  hostname `os.knoxi.dev` and the `knox-os` Worker. Keep the hostname: Worker-level Access refuses
  WebSocket upgrades, which the Workshop needs, and `cf-os check` recognizes only hostnames.
- **Admins:** `carrickm@knox.nsw.edu.au` (see `deployment.jsonc` for the current list)

## Workers

| Worker | Role | Public route |
| --- | --- | --- |
| `knox-os` | Router, serves the frontend | `os.knoxi.dev` (only public route) |
| `knox-os-workshop` | Workshop backend | none — service binding only |
| `knox-os-context` | Context Gatekeeper | none — service binding only |
| `knox-os-scheduler` | Scheduler Gatekeeper | none — service binding only |
| `knox-os-gatekeeper` | Custom Gatekeeper | none — service binding only |
| `knox-os-gk-websearch` | Web Search Gatekeeper (upstream, ambient) | none — service binding only |
| `knox-os-gk-microsoft` | Upstream Microsoft 365 Gatekeeper (`gatekeepers.microsoft`) | none — service binding only |
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

Deployed 2026-11-14 by the "Deploy production" workflow
([run 43568281855](https://github.com/knox-grammar/cloudflare-os-starter/actions/runs/43568281855))
from root `13dbd9e`, core `769474e`. Worker version rollback of `knox-os-workshop` after a
workspace has woken is unsafe; this deploy added Durable Object migration v4.

| Worker | Version ID |
| --- | --- |
| `knox-os` | `de45360f-371b-4000-856a-804b5dcab5fe` |
| `knox-os-workshop` | `429aed7a-ddb9-4a01-9d11-ddc015fbc8a6` |
| `knox-os-context` | `3a46d9ba-c0cd-44d3-84de-500e443b8e5b` |
| `knox-os-scheduler` | `2013f70a-ac69-4fa5-b338-5d546eb8b6e0` |
| `knox-os-gatekeeper` | `7df9b58d-01a5-4ded-8a71-1064662f56fd` |
| `knox-os-gk-websearch` | `f4e4d929-d883-458d-a61b-c1ff166e956f` |
| `knox-os-gk-microsoft` | `729391d7-d10b-45f4-b01d-2a87bdfb3093` (code; `cf-os secrets` then added a secrets-only version) |
| `knox-os-error-reporter` | `4afd15e9-e0fb-444f-9cb8-d0f7049b4326` |

Immediate pre-upgrade rollback targets (2026-11-14, deployed 2026-10-09 from a local machine):
`knox-os` `67aed6e5-8942-4788-bff7-cd0daac390bd`, `knox-os-workshop`
`42c8a202-0e1b-4f64-935e-f2e99e498fc5`, `knox-os-context`
`19adfb4a-757b-4c3e-b79f-1f74aa7f9568`, `knox-os-scheduler`
`f4b8cc55-37da-466f-949b-1aae61588a70`, `knox-os-gatekeeper`
`62539468-5934-4900-b87c-a851253ebd38`, `knox-os-gatekeeper-microsoft`
`8711b39d-4d45-4053-8aed-935054c61d78`, `knox-os-gatekeeper-workiq`
`fb280a3e-9a02-4cbd-ae78-ea15f1cb3ed3`, `knox-os-error-reporter`
`86f51f7f-fb1a-4e8c-978b-47a38ae58c29`. The retired Microsoft and WorkIQ Workers are no longer
bound; rolling the Workshop back is unsafe for the reason above.

Immediate pre-OS-upgrade rollback targets (2026-09-02; Workshop storage may already be
migrated): `knox-os` `28897f6b-3ef7-4f8f-8d62-ac500de59ba2`, `knox-os-workshop`
`1ef330be-ac6f-4842-a27d-53eb41300d53`, `knox-os-context`
`19a6ea72-8da6-42ec-9004-06a22b2c70f3`, `knox-os-scheduler`
`e4d402f5-1b96-432d-903d-88f3409ab2aa`, `knox-os-gatekeeper`
`ac05bccf-2db4-401b-abd3-bf5f31806c35`, `knox-os-gatekeeper-microsoft`
`39c8ebaf-0cbe-4359-89a0-d32410711cc0`, `knox-os-error-reporter`
`81b995e8-1e16-4b78-9f1c-cce381c98941`.

Immediate pre-redirect-fix rollback targets (2026-09-02): `knox-os`
`c9c2ef12-46ff-4372-bccb-35fb62b12693`, `knox-os-workshop`
`56ec48a1-51e0-46db-ac9c-f7ae19ec75ea`, `knox-os-context`
`0fcf6670-0694-4d94-9ef1-7779bfd25bde`, `knox-os-scheduler`
`0fab586e-7d69-438f-b3a2-e1a60e1386b0`, `knox-os-gatekeeper`
`3cb154f6-256b-4eb9-90ae-57a842853c54`, `knox-os-gatekeeper-microsoft`
`3392e75e-50da-4486-aa8e-fabaedace656`, `knox-os-error-reporter`
`8ece7619-18dc-433b-b454-539f1df21e81`.

Immediate pre-recursive-read rollback targets (2026-09-02): `knox-os`
`4aa36c42-9f85-4f71-953a-a503e8e5766c`, `knox-os-workshop`
`78b37a80-5af6-4b29-a0e8-2761112d528e`, `knox-os-context`
`61f6a25a-9da8-4cb3-b92e-cccf83dd189b`, `knox-os-scheduler`
`eb783738-9aa8-4697-be8d-baa140f87aef`, `knox-os-gatekeeper`
`131c2b2f-3161-4ca9-9c48-b6d9714e96c0`, `knox-os-gatekeeper-microsoft`
`0efaf5a9-7e15-4afa-8f5e-0c494d48b71e`, `knox-os-error-reporter`
`7b0f807b-611a-4c41-b18d-242a4585641e`.

Immediate pre-SharePoint rollback targets (2026-08-26): `knox-os`
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
- **`cloudflare-os` is its own pnpm workspace** with its own lockfile. The root
  `postinstall` (`cf-os install`) installs it, so `pnpm install` is enough. After
  `--ignore-scripts`, run `pnpm cf-os install`.
- The submodule is pinned by gitlink, not by branch. Never run
  `git submodule update --remote`; use
  `git submodule update --init` to sync to the commit the repo already
  points at, and see
  [`references/upgrade-and-rollback.md`](.agents/skills/cloudflare-os-operator/references/upgrade-and-rollback.md)
  to advance it deliberately.

## GitHub Actions

The Knox fork is `knox-grammar/cloudflare-os-starter`; `cloudflare/cloudflare-os-starter`
is the upstream source, not the deployment repository. `.github/workflows/check.yml` runs
`pnpm check` on PRs and `main` without Cloudflare credentials. The separate
`.github/workflows/deploy.yml` runs **only when manually dispatched on `main`**, requires the
full approved commit SHA, reruns `pnpm cf-os check`, then waits for approval in the `production`
environment before `pnpm cf-os deploy`. The environment is restricted to `main` and currently
requires approval by `mylescarrick`. Neither merging nor pushing deploys production.

The deploy workflow uses a scoped `CLOUDFLARE_API_TOKEN` stored as a **production environment
secret** in the Knox fork (first used 2026-11-14). Never put
it in a repository secret, tracked file, or chat. Scope it to the Knox account and route and
verify the actual required Workers/KV/R2/zone permissions; do not grant unrelated accounts.
`cf-os deploy` does not set Gatekeeper
secrets: install the Microsoft 365 Worker's with `pnpm cf-os secrets microsoft` (add
`--config deployment.staging.jsonc` for staging) after its Worker exists.

Before approving a production workflow run, use the operator skill and
[`plans/cloudflare-os-upgrade-2026-11.md`](plans/cloudflare-os-upgrade-2026-11.md). The
deployment is experimental and its existing data is disposable by operator decision, so no
migration rehearsal gates it; Access, storage ownership and version inventory still do. After the
run, record all new version IDs here and verify the live site; a successful Action alone is
not live verification. A failure partway through the eight Workers is not automatically rolled
back; stop and inspect remote state before retrying.

## Staging

`deployment.staging.jsonc` is a separate eight-Worker stack on `os-staging.knoxi.dev`, with its
own Worker names, Access AUD and pinned KV/R2, and only `carrickm@knox.nsw.edu.au` in `/admin`.
It shares the account's `default` AI Gateway and the Knox Entra app with production; the
staging Microsoft 365 Worker needs its own redirect,
`https://os-staging.knoxi.dev/gatekeeper/microsoft/oauth`, registered on that app. Microsoft
OAuth reaches real mail, calendar and SharePoint data. The `gatekeepers.microsoft.vars` caps
keep agents to selected sites read-only, Outlook drafts (no sending) and calendar edits (no
invitations).

Check and deploy it with the same CLI: `pnpm cf-os check --config deployment.staging.jsonc`
and `pnpm cf-os deploy --config deployment.staging.jsonc`. Never edit temporary
`wrangler.prod.jsonc` files.

### Combined checks and staging approval

`.github/workflows/check.yml` is the single delivery workflow. Pull requests run lint and both
dry-runs without credentials. Each push to `main` runs them once, checks that the `staging`
Environment still has a required reviewer and a `main`-only branch rule, then requests staging
approval. Only after approval does the job receive `STAGING_CLOUDFLARE_API_TOKEN` and run
`cf-os deploy --config deployment.staging.jsonc`, which verifies the account, Access application
and pinned storage before building and deploys the Router last. Reject superseded pending
requests rather than approving an older SHA. A failure partway through is not rolled back: stop
and inspect the Workers before retrying. Signed-in checks remain manual.

## SharePoint sites (`Sites.Selected`)

`MICROSOFT_SHAREPOINT_SITES=selected` makes connections ask for delegated `Sites.Selected`, so
Microsoft lets agents into a SharePoint site only when the user can open it *and* the site has
been granted to the Knox Entra app. Grants belong to the app's client ID, not to a Worker, so
production and staging share them and redeploys never touch them. Nothing in this repository
or the Workers can create them.

A tenant admin grants a site in [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer),
signed in as themselves and consenting to `Sites.FullControl.All` for Graph Explorer only:

```http
GET https://graph.microsoft.com/v1.0/sites/knoxnswedu.sharepoint.com:/sites/<site>?$select=id

POST https://graph.microsoft.com/v1.0/sites/<id from above>/permissions
{ "roles": ["read"], "grantedToIdentities": [{ "application": { "id": "<Entra client ID>", "displayName": "Knox OS" } }] }
```

- `GET …/sites/<id>/permissions` lists a site's grants; `DELETE …/sites/<id>/permissions/<permission id>`
  removes one. Removing consent to `Sites.Selected` removes every site at once.
- Use `"read"` unless a site should take agent writes; `MICROSOFT_SHAREPOINT_ACCESS=read` caps
  every site at read anyway.
- Upstream's full description: `cloudflare-os/packages/gatekeeper-microsoft/README.md`,
  "Only selected sites".

Granted sites:

| Site | Role | Granted |
| --- | --- | --- |
| `https://knoxnswedu.sharepoint.com/sites/digital-utilities` | `read` | 2026-09-02 |

## Routine operations

- **Deploy a config change:** edit `deployment.jsonc`, run `pnpm cf-os check`,
  review the dry-run bindings, get approval for anything touching the trust
  boundary (see the operator skill), then `pnpm cf-os deploy`. Update the version
  ID table above afterward.
- **Only one `pnpm check`/`pnpm deploy` at a time** against this checkout.
  Use a separate worktree for concurrent work.
- **Upgrading** is `pnpm cf-os update` (starter merge) or `pnpm cf-os update --upstream`
  (core `main`), then the `.cf-os/update.md` checklist — follow
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
- [ ] Delete the retired `knox-os-gatekeeper-microsoft` and
      `knox-os-gatekeeper-workiq` Workers (and staging equivalents) once the new stack is
      verified. Deleting them discards their stored Microsoft connections.
