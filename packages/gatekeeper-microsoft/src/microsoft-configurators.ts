import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import { CalendarApi, MailApi } from "./microsoft-api";
import type { AccessTokenProvider } from "./auth-retry";
import type {
  OutlookCalendarConfiguratorRpc,
} from "./configurator/outlook-calendar-configurator-types";
import type {
  ConfiguratorOption,
  OutlookMailConfiguratorRpc,
} from "./configurator/outlook-mail-configurator-types";

function matchesQuery(option: ConfiguratorOption, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const searchable = [option.value, option.title, option.subtitle, option.meta]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every(term => searchable.includes(term));
}

/** Narrow RPC capability exposed only to the sandboxed Outlook Mail picker iframe. */
@validateRpc()
export class OutlookMailConfiguratorUI extends RpcTarget implements OutlookMailConfiguratorRpc {
  #getToken: AccessTokenProvider;
  #folders?: Promise<ConfiguratorOption[]>;

  constructor(getToken: AccessTokenProvider) {
    super();
    this.#getToken = getToken;
  }

  async listFolders(query: string): Promise<ConfiguratorOption[]> {
    if (!this.#folders) {
      this.#folders = new MailApi(this.#getToken).listFolders().then(folders =>
        folders
          .map(folder => ({ value: folder, title: folder }))
          .toSorted((a, b) => a.title.localeCompare(b.title)));
      this.#folders.catch(() => { this.#folders = undefined; });
    }
    return (await this.#folders).filter(folder => matchesQuery(folder, query));
  }
}

/** Narrow RPC capability exposed only to the sandboxed Outlook Calendar picker iframe. */
@validateRpc()
export class OutlookCalendarConfiguratorUI extends RpcTarget implements OutlookCalendarConfiguratorRpc {
  #getToken: AccessTokenProvider;
  #calendars?: Promise<ConfiguratorOption[]>;

  constructor(getToken: AccessTokenProvider) {
    super();
    this.#getToken = getToken;
  }

  async listCalendars(query: string): Promise<ConfiguratorOption[]> {
    if (!this.#calendars) {
      this.#calendars = new CalendarApi(this.#getToken).listCalendars().then(calendars =>
        calendars
          .filter(calendar => calendar.canEdit)
          .map(calendar => ({
            value: calendar.id,
            title: calendar.name,
            subtitle: calendar.isDefaultCalendar ? "Default calendar" : undefined,
            meta: "Can edit",
          }))
          .toSorted((a, b) => a.title.localeCompare(b.title)));
      this.#calendars.catch(() => { this.#calendars = undefined; });
    }
    return (await this.#calendars).filter(calendar => matchesQuery(calendar, query));
  }
}
