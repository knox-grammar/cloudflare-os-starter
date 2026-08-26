---
name: calendar-queries
description: Read a calendar accurately and efficiently in the deployment timezone.
---

# Calendar queries

Use this skill whenever a user asks about dates, appointments, availability, or a calendar range.

## Rules

1. Call `describeBinding()` once before using a new calendar binding.
2. Import the built-in time utility once:

   ```js
   import { today, daysFromToday, nextWeekday, dayRange, format, timeZone } from "time.js";
   ```

   It uses the deployment timezone, currently `Australia/Sydney`. Never derive “today” from the
   Worker runtime's UTC clock or guess it from the prompt.
3. Interpret relative dates once. If “tomorrow” and “Friday” could be the same date, ask the user
   which Friday they mean instead of silently choosing next week.
4. Compute every distinct day/range before reading. Make **one** `getEvents(from, to)` call per
   distinct range. Do not reread the calendar just to format or sort the result.
5. Convert RPC-returned values before comparing or sorting:

   ```js
   events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
   ```

6. Present grouped, chronological results and state the timezone. Keep cancelled events visibly
   marked rather than silently removing them.

## Example

```js
import { daysFromToday, dayRange, format, timeZone } from "time.js";

const tomorrow = daysFromToday(1);
const { from, to } = dayRange(tomorrow);
const events = await env.CALENDAR.getEvents(from, to);
events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

console.log({
  date: tomorrow.toString(),
  timeZone,
  events: events.map(event => ({
    title: event.title,
    start: format(event.start, { hour: "numeric", minute: "2-digit" }),
    end: format(event.end, { hour: "numeric", minute: "2-digit" }),
    cancelled: event.cancelled,
  })),
});
```

This file is reviewed source content. To make it available to deployed agents, an administrator
must add it to a public Context Library collection. Do not treat a checkout-local skill as live.
