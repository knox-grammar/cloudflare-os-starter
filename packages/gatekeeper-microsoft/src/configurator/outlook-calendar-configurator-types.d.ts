import type { ConfiguratorOption } from "./outlook-mail-configurator-types";

export type OutlookCalendarConfiguratorValues = {
  calendarId?: string | null;
}

/** Narrow RPC surface exposed only to the sandboxed calendar resource-picker iframe. */
export interface OutlookCalendarConfiguratorRpc {
  listCalendars(query: string): Promise<ConfiguratorOption[]>;
}

export type { ConfiguratorOption };
