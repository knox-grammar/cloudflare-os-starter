# Agent time utilities and calendar-reading skill

## Goal

Make calendar/date requests fast, correct, and predictable for the Knox deployment. An agent must
not spend turns guessing the current date, inventing ambiguous relative-date rules, rereading the
same calendar range to fix presentation, or relying on the Worker runtime's UTC timezone.

## Decision

- Deployment default timezone: **`Australia/Sydney`** (approved 2026-08-26).
- Use **Temporal**, not `date-fns`. `date-fns` is not timezone-complete by itself, and adding it to
a package manifest does not make it importable by dynamically loaded `executeCode` Workers.
- The time API is read-only and pure. It gives no network, storage, binding, or user-data authority.
- Calendar-specific usage guidance is a skill, but it must be delivered through the Context Library
  or deployment-wide instructions, not merely committed under this checkout: local `.agents/skills`
  files instruct coding agents, not the deployed Workshop agent.

## Problem observed

The first Outlook Calendar query took several minutes of model reasoning and four repeated resource
reads per pass. The agent did not know the user timezone, repeatedly reconsidered what “Friday”
meant, used the sandbox's UTC formatting, and tried to sort RPC-transferred dates without converting
them. The calendar gatekeeper returned data correctly; the execution environment and guidance did
not make the correct, cheap path obvious.

## Proposed design

### 1. Code-mode `time` module

Add a pre-bundled module to every dynamic code-mode Worker, importable as:

```ts
import { now, today, daysFromToday, nextWeekday, dayRange, format } from "time";
```

It uses a bundled Temporal implementation and a deployment-provided default timezone.

- `now(): Temporal.ZonedDateTime` — current instant in `Australia/Sydney` by default.
- `today(): Temporal.PlainDate` — current local calendar date.
- `daysFromToday(days: number): Temporal.PlainDate` — calendar arithmetic, never 24-hour elapsed
  arithmetic across DST.
- `nextWeekday(weekday, { after? })` — explicit inclusive/exclusive behavior; the caller must say
  whether a same-day Friday is intended.
- `dayRange(date): { from: Date; to: Date }` — local midnight-to-midnight `[from, to)` range ready
  for a gatekeeper `getEvents(from, to)` call.
- `format(value, options?)` — explicit-zone display formatting.

The WorkerLoader module map currently contains only `harness.js` and agent-generated `agent.js`.
The implementation must bundle Temporal into a static source module at build time and add it to that
map, rather than relying on a bare package import that a dynamically loaded Worker cannot resolve.

### 2. Prompt-level API documentation

Extend `executeCode` tool documentation with the module name, timezone default, examples, and a
rule that relative-time questions must use `time` instead of manually calculating date boundaries.
This makes the utility discoverable without a preliminary `describeBinding` call.

### 3. Calendar skill

Create a public Context Library skill, `calendar-queries`, containing:

1. Call `describeBinding()` once.
2. Interpret relative dates with `time`; when “Friday” can equal “tomorrow”, ask rather than silently
   choose the following week.
3. Compute all distinct day ranges once, then make one `getEvents(from, to)` call per range.
4. Convert each returned timestamp with `new Date(event.start)` before sorting or formatting.
5. Sort locally once and return a concise grouped answer. Never rerun reads only to change display.
6. State the timezone (`Australia/Sydney`) in calendar answers.

The source repository can hold the skill content for review, but live availability requires either a
public Context Library collection populated by an administrator or a future supported seeded-skill
mechanism. Do not silently enable Context Artifacts or create a public collection as part of code
deployment.

## Delivery order

1. Add a narrow module-bundle seam and deterministic unit tests for Sydney date boundaries,
   including AEDT/AEST transitions and `nextWeekday` semantics.
2. Add the `time` module to dynamic WorkerLoader executions and prompt documentation; test a real
   generated agent module imports it and receives the expected range.
3. Add reviewed `calendar-queries/SKILL.md` source content.
4. Ask the deployment admin to create/populate the public Context Library skill collection, or build
   an explicit seed mechanism as separate work.
5. Deploy only after the module tests and full `pnpm check` pass; test one live low-cost calendar
   read with the agent.

## Acceptance checks

- Agent code can import `time` in the actual dynamic WorkerLoader execution path.
- `dayRange(Temporal.PlainDate.from("2026-10-04"))` is correct across Sydney daylight-saving start,
  and the equivalent autumn boundary is correct too.
- A calendar query for two distinct days makes exactly two calendar reads, not repeated formatting
  reads.
- The agent receives explicit module documentation and the live `calendar-queries` skill is visible
  in the Context Library catalog.
- No new external authority, public route, secret, or data collection is introduced.

## Out of scope

- Changing the Outlook Calendar session API.
- Guessing personal timezone from email domain, IP address, or calendar metadata.
- Automatic interpretation of ambiguous natural language such as “tomorrow and Friday” when both
  could name the same day.
- Enabling Context Artifacts.
