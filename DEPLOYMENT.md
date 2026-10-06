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
| `knox-os-gatekeeper-microsoft` | Microsoft Outlook and selected SharePoint Gatekeeper | none — service binding only |
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

Queried from Cloudflare deployments on 2026-09-28 (these versions were deployed 2026-09-15,
after the previously recorded `2e37d67f` upgrade). The exact source commit for that later
deployment was not verified. Worker version rollback of `knox-os-workshop` after a workspace has
woken is unsafe.

| Worker | Version ID |
| --- | --- |
| `knox-os` | `04afe915-2854-4cac-8ab7-aebf97bb0409` |
| `knox-os-workshop` | `9168ae14-8827-4ba2-8231-98ba94e0bac3` |
| `knox-os-context` | `4b8cc05b-f271-4dbc-8483-8061e313ad19` |
| `knox-os-scheduler` | `2789e162-f904-421e-a91b-312f0b751ce1` |
| `knox-os-gatekeeper` | `e5861df6-4695-4701-9fd7-ca16bb912ec5` |
| `knox-os-gatekeeper-microsoft` | `0d7d6316-0582-4c83-bfb6-5247300e7bdb` |
| `knox-os-error-reporter` | `8dc27e76-176d-4217-9987-817a18efe542` |

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

## GitHub Actions

The Knox fork is `knox-grammar/cloudflare-os-starter`; `cloudflare/cloudflare-os-starter`
is the upstream source, not the deployment repository. `.github/workflows/check.yml` runs
`pnpm check` on PRs and `main` without Cloudflare credentials. The separate
`.github/workflows/deploy.yml` runs **only when manually dispatched on `main`**, requires the
full approved commit SHA, reruns `pnpm check`, then waits for approval in the `production`
environment before `pnpm deploy`. The environment is restricted to `main` and currently
requires approval by `mylescarrick`. Neither merging nor pushing deploys production.

The deploy workflow is **not activated** until an authorized operator creates a scoped
`CLOUDFLARE_API_TOKEN` as a **production environment secret** in the Knox fork. Never put
it in a repository secret, tracked file, or chat. Scope it to the Knox account and route and
verify the actual required Workers/KV/R2/zone permissions; do not grant unrelated accounts.
No token was installed during the workflow setup. If Microsoft or Workshop secrets are missing
on a new Worker identity, install them separately by the approved interactive procedure;
`pnpm deploy` does not provision those secrets.

Before approving a production workflow run, use the operator skill and
[`plans/cloudflare-os-upgrade-2026-09.md`](plans/cloudflare-os-upgrade-2026-09.md): rehearse
migration `v3`, verify Access and storage ownership, inventory current deployment versions,
review the per-Worker rollback matrix and get explicit production mutation approval. The
workflow's dry-run cannot prove remote ownership or the existing-data migration. After the
run, record all new version IDs here and verify the live site; a successful Action alone is
not live verification. A failure partway through the seven Workers is not automatically rolled
back; stop and inspect remote state before retrying.

## Staging (deployed, signed-in verification pending)

The approved private bootstrap and subsequent public staging release succeeded. Resource
identities are pinned in `deployment.staging.jsonc`; both mutation gates are closed again.
See [`plans/staging-public-release-record.md`](plans/staging-public-release-record.md) for
version IDs, anonymous Access checks and remaining signed-in verification. No production
release is authorized by this staging smoke test.

`deployment.staging.jsonc` is a separate seven-Worker config on the approved hostname
`os-staging.knoxi.dev`, with its own Access AUD and only `carrickm@knox.nsw.edu.au` in
`/admin`. The wrapper uses **one** config generator/build/deploy order for both targets.
`pnpm check:staging` runs tests, builds and seven Wrangler dry-runs without touching Cloudflare;
`pnpm check:staging:bootstrap` dry-runs only the six private Workers. CI runs both after
`pnpm check`. Never edit temporary `wrangler.prod.jsonc` files.

Staging shares two external services with production **by explicit operator approval**:
the Entra app/tenant/assigned SharePoint site, and the `default` AI Gateway (including its
billing and logging policy). Worker identities and persisted storage remain separate. Only
the staging Microsoft Worker may receive the existing OAuth app credentials, and its OAuth
redirect must be separately registered as
`https://os-staging.knoxi.dev/gatekeeper/microsoft/oauth`. Microsoft OAuth accesses real
mail, calendar and assigned-site data; approved mail/calendar actions can change real data.

Both live commands are **blocked before remote mutation**. After separate provisioning
approval, change only `staging.bootstrapReady` in the reviewed config, then
`pnpm deploy:staging:bootstrap` can create six **private** Workers and four new KV/R2
resources; it never deploys the Router. Record and pin all four generated storage IDs/names,
then separately review the OAuth credential bootstrap and public release. `pnpm deploy:staging`
requires `staging.releaseReady: true` **and** all four storage identities pinned, even if
bootstrap already passed. A passing dry-run is not provisioning or public-release approval.
The operator approved the existing select staging Access group, which includes
`carrickm@knox.nsw.edu.au`, while `/admin` remains exclusive to that address. Before
changing the reviewed flag, independently confirm the application's exact Allow group,
hostname, IdP and absence of Bypass/Everyone, and verify an allowed member and a denied
identity. Register and check the exact OAuth redirect, plan the Worker-scoped secret bootstrap
without exposing values or accidentally deploying a public Router, and agree on read-only
Microsoft tests and an AI spend/logging limit. **Every allowed member can connect their own
real Microsoft account** because the ordinary Gatekeeper is enabled by default; `/admin`
alone does not restrict connector access. `pnpm secrets:set` targets production, **never**
use it for staging. Keep the staging deployment workflow protected.
See
[`plans/staging-operations.md`](plans/staging-operations.md) for first-deploy resource identities,
existing-data rehearsal, negative Access checks and the production release gate.

### Combined checks and staging approval

`.github/workflows/check.yml` is the single delivery workflow. Pull requests run credential-free
checks only. Each push to `main` checks production, staging and private bootstrap once, then
requests **staging Environment approval**. No Cloudflare token is available before that approval.
Manual dispatch on `main` remains available for a deliberate fresh check/redeployment.
The deploy job updates the **existing** stack, never bootstraps Workers or installs OAuth secrets.
Production deployment remains separate and unchanged. Both checkout jobs pin the same event SHA;
there is no separate SHA input or second dry-run workflow.

Before first use, separately configure GitHub Environment **`staging`** with a required reviewer,
exactly one custom deployment branch rule (`main`, type `branch`), and the environment secret
**`STAGING_CLOUDFLARE_API_TOKEN`**. The workflow fails if reviewer/branch protection is missing;
the dedicated secret name avoids falling back to the production token. The operator configured
reviewers `mylescarrick`/`nickec86`, self-review allowed, exactly one Branch `main` rule, and the
secret. These protections passed hosted preflight. The first scoped-token deployment failed at
Router zone lookup (run `36956274641`); token/Custom Domain compatibility remains unresolved.
Do not broaden permissions or retry automatically. No GitHub settings are created by this code.

After merging, use the **Check and staging** run for that main commit. After checks and protection
preflight pass, review its exact SHA and approve the staging job when deployment is wanted.
Reject superseded pending requests; never silently switch the checked SHA to newer main.
The helper verifies existing Worker deployments, Microsoft secret names and pinned storage before
opening the release gate only in the runner's temporary config and restoring it afterward.
Tracked gates stay closed. Deployment-job concurrency serializes staging mutations without
canceling active deployments or blocking checks for other commits. Feature-branch manual runs
perform checks only, with no staging approval request or credentials.

The job records sanitized current deployment/version IDs and anonymous Access probes in a
**30-day** artifact, including partial deployment failures, linked to the same run's `check` job. It retains no cookies, redirects,
response bodies, author emails or deployment annotations. If any deploy or probe fails, stop,
inventory the seven Workers and review recovery; no automatic retry or rollback. Versions in
the artifact describe observed account state, not proof that every Worker deployed the requested
SHA. A canceled run may have no artifact. Signed-in user/admin/Microsoft and persistence checks
remain manual; a green run is not migration rehearsal or production release approval.

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
