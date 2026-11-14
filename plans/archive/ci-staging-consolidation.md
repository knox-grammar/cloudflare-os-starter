# Consolidate CI and staging delivery

Status: operator approved the lifecycle change; implementation prepared on `ci/unified-staging`, pending full verification and review. The preceding deployment completed with Router zone-lookup failure (run `36956274641`); do not broaden token permissions or retry it as part of this work. No existing branch protection or repository ruleset was found. The `check` job and workflow filename remain stable.

## Recommendation

Replace Check and Deploy staging with one delivery workflow. Pull requests run credential-free checks only. A push to main runs those same checks once, then queues a staging deployment behind the existing GitHub Environment approval. Approval is still required before any token is available or any Cloudflare mutation occurs. Keep production deployment separate and unchanged.

This changes one operating rule: staging no longer needs a separate manual workflow dispatch after a merge. Each main push automatically requests staging approval; it does not automatically deploy. Operator approval of this change is required before implementation.

## Jobs and events

1. `check`: pull_request, push to main, and optional workflow_dispatch on main. Checkout the event's immutable SHA and submodule; run the current credential-free test/build/dry-run checks for production, staging, and private bootstrap. PR merge-ref verification is not reused for the merged main SHA. Preserve a stable required-check name and inspect branch protection before renaming existing checks.
2. `staging-preflight`: needs successful check; only the Knox repository, main branch, and push/workflow_dispatch events. Check staging reviewer protection and exact main-only branch policy before entering the Environment, so missing settings cannot silently create an unprotected deployment. No Cloudflare token here.
3. `deploy-staging`: needs preflight; uses the staging Environment and its dedicated STAGING_CLOUDFLARE_API_TOKEN. Checkout the same exact SHA as check and assert it. Retain existing Worker/secret-name/pinned-storage checks, temporary release gate, Router-last deploy, partial-state evidence, 30-day sanitized artifact and manual-check reminder. Record the check job/run and source SHA in deployment evidence.

PR and feature-branch runs must never request Environment approval or receive Cloudflare credentials. Default-branch verification must succeed before staging becomes eligible. GitHub Environment approvals may be rejected or left waiting when staging is not wanted. Manual dispatch on main remains available for a deliberate re-run; it performs a fresh check in the same run rather than complicated cross-run CI lookup.

## What duplication disappears

The normal merge path changes from three credential-free Worker dry-run passes in Check plus two more in Deploy staging to one set of three. The deploy job must still install dependencies and build Workers before uploading; do not describe those deployment builds as redundant dry-run validation. No cross-run artifacts or caches become trusted build inputs. A single workflow removes duplicate definitions and provides one visible check-to-approval-to-deploy chain.

Initially retain all three existing dry-run modes. Whether the six-Worker bootstrap dry-run is redundant with order/unit tests is a separate optimization, not part of this change.

## Concurrency and failure

Put `knox-staging` concurrency on the deployment job, not the whole workflow, with cancel-in-progress false. Checks for other commits must not cancel an approved or active Cloudflare deployment. No automatic retry or rollback. Pending approvals for superseded main commits should be rejected; show the exact SHA clearly before approval. Do not silently deploy the newest main commit after checking an older one.

Preserve evidence collection after deployment failure and acknowledge that cancellation can prevent artifact upload. A green workflow is not signed-in verification, migration evidence, or production promotion approval. The scoped token's Custom Domain compatibility is independent of this consolidation and must be evaluated from the currently running deployment.

## Implementation tasks

1. Inspect current main workflows, script tests and branch-required-check configuration; establish stable job/check names.
2. Implement the consolidated workflow and event guards. Retire deploy-staging.yml without modifying production deploy.yml. Keep existing main check filename/job if that avoids branch-rule churn.
3. Update workflow/helper tests and release docs: normal merged main run pauses for approval; no manual SHA entry needed because the checked SHA is pinned throughout. Keep main-only manual re-run, exact SHA assertions and closed tracked gates.
4. Verify YAML, event/credential/gate tests, script type-checking/lint and all three dry-runs on the final diff. Test PR skips deployment, main gates on checks and protection, failed checks block deployment, exact SHA cannot drift, and deployment failure preserves evidence.
5. Review, request commit/PR approval, merge only after approval. Observe one main push producing one check job and one pending staging approval; approve a staging deploy separately. Do not dispatch or mutate Cloudflare during implementation.

## Out of scope

Production deployment changes, cf migration, token broadening, storage migrations, automatic promotion, cached binary deployment, and changes to Access/OAuth credentials or GitHub protection settings.
