# Working in Amp orbs

Amp runs `.agents/setup` when preparing a fresh orb without an exact project snapshot,
then snapshots the installed tools, dependencies and caches. An exact snapshot skips setup;
a stale snapshot retains its caches, updates the checkout and runs setup again. Snapshots
may be reused for up to 72 hours. These files must reach the Amp project's default branch
before future orbs use them; a local commit alone does not activate setup.

## What startup prepares

- Node's major version from `.nvmrc` (currently 26, also used by CI). The base orb's
  matching Node is reused; otherwise nvm installs it.
- Standalone pnpm at the root `packageManager` version (currently 11.17.0), reused when
  already correct. Old Corepack versions cannot launch pnpm 11's ESM shim. Tool paths
  are persisted in a repository-scoped login-shell hook for Amp and supervised services.
- The exact `cloudflare-os` gitlink, never its latest branch head.
- `pnpm install --frozen-lockfile`, whose root `postinstall` (`cf-os install`) installs the
  submodule's own workspace from its own lockfile. Startup does not build Workers or run tests.

Setup prints timings for each major step and fails on an incompatible pin or lockfile rather
than updating it. `.agents/resume` only checks that the submodule is at its gitlink; it performs
no installs or network requests. Neither script signs in to Cloudflare or Microsoft, sets
secrets, or deploys anything. Do not put credentials in setup: its snapshot is shared.

To validate lifecycle changes in an orb:

```sh
bash -n .agents/setup .agents/resume
time .agents/setup
time .agents/setup
time .agents/resume
pnpm lint
pnpm cf-os check
```

There is no automatic dev server: if needed, start one through Amp's supervised orb services.
Portal metadata under `.amp/portals/` and `cf-os update`'s `.cf-os/` brief are ignored.

## Three ownership boundaries

| Layer | Source of truth | How changes arrive |
| --- | --- | --- |
| Knox deployment/customizations | This repository's `origin`: `deployment*.jsonc`, `packages/custom-gatekeeper`, `packages/error-reporter`, workflows | Normal reviewed changes |
| Starter upstream | `https://github.com/cloudflare/cloudflare-os-starter` | `pnpm cf-os update` (merges its `main` and its pin) |
| Cloudflare OS core | `.gitmodules` URL `https://github.com/cloudflare/cloudflare-os.git` and the parent gitlink | `pnpm cf-os update --upstream` (stages core `main`, uncommitted) |

Run either with `--dry-run` first to see both commit ranges. Each writes `.cf-os/update.md`;
work through its checklist and `.agents/skills/cloudflare-os-operator/references/updating.md`
on a branch, keep fixes in commits after the merge, and finish with `pnpm lint` and
`pnpm cf-os check` for both deployment files. Never use `git submodule update --remote`.
Deploys refuse a submodule that is not at its gitlink.

## Microsoft 365 comes from upstream

Knox no longer carries its own Microsoft or WorkIQ Gatekeeper. Upstream's Microsoft 365
Gatekeeper is selected as `gatekeepers.microsoft` in both deployment files, with Knox's access
caps in its `vars`; its secrets are set with `pnpm cf-os secrets microsoft`. Core is never
patched locally, so `git status` should show a clean `cloudflare-os`.
