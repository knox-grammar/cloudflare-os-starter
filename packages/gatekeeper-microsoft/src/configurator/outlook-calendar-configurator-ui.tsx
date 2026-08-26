import { Autocomplete, Field, h, Section, type ConfiguratorUISpec } from "@gadgets/configurator-ui";
import type {
  OutlookCalendarConfiguratorRpc,
  OutlookCalendarConfiguratorValues,
} from "./outlook-calendar-configurator-types";

export default {
  initial: {},

  isReady({ values }) {
    return typeof values.calendarId === "string" && values.calendarId.length > 0;
  },

  initialValuesFromResourceUrl({ resourceUrl }) {
    const segments = new URL(resourceUrl).pathname.split("/").filter(Boolean);
    const calendarId = segments[0] === "calendar" ? segments[1] : undefined;
    return calendarId ? { calendarId: decodeURIComponent(calendarId) } : {};
  },

  resourceUrl({ values }) {
    return `https://outlook.office.com/calendar/${encodeURIComponent(values.calendarId ?? "")}/`;
  },

  render({ values, setValues, ui }) {
    return <Section>
      <Field
        label="Calendar"
        description="Choose the calendar this connection can read and manage. Only calendars you can edit are shown."
      >
        <Autocomplete
          name="calendarId"
          value={values.calendarId}
          placeholder="Search calendars..."
          loadOptions={query => ui.listCalendars(query)}
          onChange={calendarId => setValues({ calendarId })}
        />
      </Field>
    </Section>;
  },
} satisfies ConfiguratorUISpec<OutlookCalendarConfiguratorRpc, OutlookCalendarConfiguratorValues>;
