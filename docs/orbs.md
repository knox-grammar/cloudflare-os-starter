# Working in Amp orbs

Amp runs `.agents/setup` when preparing a fresh orb without an exact project snapshot,
then snapshots the installed tools, dependencies and caches. An exact snapshot skips setup;
a stale snapshot retains its caches, updates the checkout and runs setup again. Snapshots
may be reused for up to 72 hours. These files must reach the Amp project's default branch
before future orbs use them; a local commit alone does not activate setup.

## What startup prepares

- Node's major version from `.nvmrc` (currently 26, also used by CI). The base orb's
  matching Node is reused; otherwise nvm installs it. The manifest's minimum Node version
  is not the CI/orb version pin.
- Standalone pnpm at the root `packageManager` version (currently 11.17.0), reused when
  already correct. Old Corepack versions cannot launch pnpm 11's ESM shim. Tool paths
  are persisted in a repository-scoped login-shell hook for Amp and supervised services.
- The exact `cloudflare-os` gitlink, never its latest branch head.
- Both independent workspaces, each with `pnpm install --frozen-lockfile`. The wrapper's
  selected core packages belong to its root workspace, but do not replace the full core
  install needed for upstream builds and tests. Both installs reuse pnpm's local store.
- WorkIQ's exact-pin patch via `scripts/prepare-workiq.ts`, then the native MCP
  configurator imported by the adapter. Build and test commands generate other outputs
  as needed; startup does not prebuild every Worker or run the whole test suite.

Setup prints timings for each major step. It fails on incompatible pins, patches or
lockfiles rather than silently updating them. No dependency fingerprint is needed:
pnpm's warm install verifies the existing workspaces cheaply.

`.agents/resume` runs after activation and on wake. It checks the core pin and reapplies
the small WorkIQ extension if absent. It performs no installs or network requests.
Neither script logs into Cloudflare or Microsoft, installs OAuth credentials, changes
Gatekeeper authority, provisions resources, or deploys anything. Do not put credentials
in setup: its snapshot can be reused across people and threads.

To validate lifecycle changes in an orb:

```sh
bash -n .agents/setup .agents/resume
time .agents/setup
time .agents/setup
time .agents/resume
pnpm run types:scripts
pnpm --filter @knox/gatekeeper-workiq run types:check
pnpm --filter @knox/gatekeeper-workiq run test:run
```

Use the current project-pinned tools for further checks. For cloud operations, follow
the operator skill and deployment approval gates. There is no automatic dev server:
if needed, start one through Amp's supervised orb services, not a detached shell process.
Portal metadata under `.amp/portals/` is ignored.

## Three ownership boundaries

| Layer | Source of truth | How changes arrive |
| --- | --- | --- |
| Knox deployment/customizations | This repository's `origin`, `deployment*.jsonc`, `packages/`, `scripts/`, `patches/` | Normal reviewed wrapper changes |
| Starter upstream | `https://github.com/cloudflare/cloudflare-os-starter` | Explicit review and merge/cherry-pick into this wrapper |
| Cloudflare OS core | `.gitmodules` URL `https://github.com/cloudflare/cloudflare-os.git` and the parent gitlink | Explicit reviewed submodule upgrade |

The root checkout currently configures only `origin`; a Git remote is local metadata,
not something a clone inherits from tracked files. To compare starter updates, add an
`upstream` remote if absent (verify its URL if already present), then fetch without
recursing into historical submodules:

```sh
git remote add upstream https://github.com/cloudflare/cloudflare-os-starter.git
git fetch --no-recurse-submodules upstream
git log --oneline HEAD..upstream/main
git diff HEAD...upstream/main -- . ':!cloudflare-os'
```

Inspect the gitlink difference separately with `git diff HEAD...upstream/main -- cloudflare-os`.
Review starter changes against Knox deployment scripts, configuration, packages, the
workspace catalog and both lockfiles. Do not overwrite them with upstream files or
automatically accept an upstream gitlink change. Fetching is not merging or upgrading.
If the wrapper checkout is shallow, obtain history with
`git fetch --unshallow --no-recurse-submodules origin` before history comparisons.
Avoid recursive history fetches: old wrapper commits can reference core commits no
longer available from the public upstream, even when the current pin is available.

For core upgrades, follow [the upgrade checklist](customization.md#upgrade) and the
operator skill's pinned-submodule upgrade guidance. Never use `submodule update --remote`.
Review migrations and RPC compatibility, keep shared workspace catalog entries aligned,
regenerate lockfiles deliberately, and run the relevant wrapper and core checks.

## WorkIQ customization is a deliberate local patch

`packages/gatekeeper-workiq` wraps the native MCP connector rather than copying it.
`patches/workiq-native-mcp.patch` is the tracked distribution of the minimal shared-source
extension; `scripts/prepare-workiq.ts` enforces its reviewed core commit. Consequently,
`git status` normally reports a dirty `cloudflare-os` submodule after setup. Its expected
tracked diff is exactly that patch, not a new gitlink or upstream commit. Do not hide it
with a submodule ignore rule, reset it, or commit it inside the core repo as an orb fix.
Use `git -C cloudflare-os diff` to distinguish this expected delta from other edits.

When changing the core pin, reconcile the extension explicitly in a disposable upgrade
worktree: remove only the old patch with `git -C cloudflare-os apply --reverse
../patches/workiq-native-mcp.patch`, check out the reviewed new core commit, and port or
retire the patch. Update the preparer's exact pin and its regression fixture together,
review both lockfiles/catalogs, then validate WorkIQ types, OAuth/policy tests, the workerd
suite and its real dry-run bundle. Do not relax the exact-pin guard to make startup pass.
Setup refuses to move a dirty core checkout to a different parent pin, preserving local
work instead of automatically reversing patches or resetting files.

The separate `packages/gatekeeper-microsoft` Graph integration remains wrapper-owned.
Installing it or WorkIQ locally does not prove hosted OAuth, tenant consent, live endpoint
access, or permission to enable or deploy either connector.
