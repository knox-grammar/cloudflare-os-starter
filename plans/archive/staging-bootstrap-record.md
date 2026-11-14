# Private staging bootstrap record

Date: 2026-09-29 (local session). Source: `fd4d8e005293b5fc6b273230ba7c2b07e4e8163d`, with only `bootstrapReady` temporarily enabled. Cloudflare OS: `32ce152654e8a205b54e094e31be932c620dbc52`. Account: `2ddaede0fbdd479a6bf410a5f1eb76ad`.

The operator explicitly approved six private Workers and four new staging resources. Initial attempt failed resolving Cloudflare API DNS at the first Worker. All seven staging Worker names were confirmed absent before the operator-approved retry. Retry exited successfully. Both mutation gates are now false again.

## Worker versions

- `knox-os-staging-error-reporter`: `5a4d8f17-3638-415f-9505-dc0e0d62d9b4`
- `knox-os-staging-context`: `6558f4c6-85be-4e04-bd7e-a8e4e4850cba`
- `knox-os-staging-scheduler`: `15cad14c-2990-46ed-8d27-eb058f28e607`
- `knox-os-staging-gatekeeper`: `c44a71c1-416a-4257-9fce-529732d80e89`
- `knox-os-staging-gatekeeper-microsoft`: `74fa9f7b-4bd2-40fd-8e52-b01e47291466`
- `knox-os-staging-workshop`: `112ab233-daa9-4cd1-be44-d6be1518e608`

## Pinned storage

- Context KV: `2fdcfa2c9f7b4d43be0cd89969add600`
- Blueprints KV: `a629ea0ee821410a9bf73f15d302dc79`
- Avatars KV: `7293853e52d9405fa170b6cb8b18b025`
- Blueprint Content R2: `knox-os-staging-workshop-blueprint-content`

These identities come from successful Wrangler deployment binding output and are now pinned in `deployment.staging.jsonc`.

## Remaining gates

No Router deployment or Access changes were performed. Production was not deployed. After bootstrap, the operator reported adding the staging Web OAuth redirect to the existing Entra app. The approved credential transfer installed `CLIENT_ID` and `CLIENT_SECRET` on `knox-os-staging-gatekeeper-microsoft` only, resolving existing 1Password references in memory. Secret names were verified without displaying values. The two writes produced versions `bd939cb5-903a-4a8b-a120-0807c366dd2b` and `78e960df-c40f-49e6-9506-420070807e0f`; Router absence was rechecked. Generated private Worker configs disable workers.dev and preview URLs and contain no routes; account-side alternate exposure still needs verification before public release. Access policy is operator-attested, not independently verified. Public release still needs separate approval and end-to-end Access/OAuth verification. The OAuth redirect is operator-attested; credentials are installed but a login has not been exercised. This fresh-stack bootstrap is not an existing-data migration rehearsal or production-upgrade evidence.
