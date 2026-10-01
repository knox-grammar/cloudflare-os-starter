# Staging public release record

Source: `0f9a1e7bec7e51fed885c8194c5130c70ed33024`, with only `staging.releaseReady` temporarily enabled for the operator-approved release. Cloudflare OS: `32ce152654e8a205b54e094e31be932c620dbc52`. Account: `2ddaede0fbdd479a6bf410a5f1eb76ad`. Hostname: `os-staging.knoxi.dev`.

All seven staging dry-runs passed before deployment. Full staging deployment exited successfully, Router last. Both mutation flags were restored to false. Production Workers were not deployed.

## Deployed versions

- Error Reporter: `5c109cbd-aab7-4443-8d66-b97fb63e6388`
- Context: `c99bc469-831a-4eb1-86b5-cfc856e1fa9b`
- Scheduler: `ec1bd4b4-1cf5-4a38-bbb7-76910f20ee20`
- Custom Gatekeeper: `d10cbf9e-7999-41a9-9f58-d98ec2c375c1`
- Microsoft Gatekeeper: `1cac17a6-ab6f-43ba-8bd7-5ea29fc1ef34`
- Workshop: `864e255a-a5c5-42b2-9f81-a583ea727edc`
- Router: `7ad4e340-d9d6-4ec3-a99b-2624c75a6a5f`

## Verification

Anonymous HTTPS requests to `/`, `/admin`, `/api`, and `/gatekeeper/microsoft/oauth` returned HTTP 302 with redirect host `knoxgrammar.cloudflareaccess.com`. No response bodies, cookies or authentication parameters were retained in this record. The Microsoft Worker's `CLIENT_ID` and `CLIENT_SECRET` names remain present after redeployment; no values were displayed. Storage remains pinned to the four identities in `deployment.staging.jsonc`.

The select Access group's policy and additional Entra redirect are operator-attested. Signed-in allowed and denied identities, sole-admin enforcement, non-admin denial, Microsoft OAuth, read-only Graph behavior, WebSockets and a low-cost AI request still need testing. Backend alternate exposure has not been independently inventoried. This is a fresh-stack smoke-test deployment, not a persisted-data migration rehearsal or production release approval.

If verification fails, stop testing and review a recovery plan. Do not change production or assume Workshop code rollback reverses storage migrations.
