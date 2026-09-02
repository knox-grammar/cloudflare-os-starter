import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import { CalendarApi, MailApi } from "./microsoft-api";
import { SharePointApi } from "./sharepoint-api";
import {
  formatSharePointDocumentResource,
  parseSharePointDocumentResource,
} from "./sharepoint-resources";
import type { AccessTokenProvider } from "./auth-retry";
import type {
  OutlookCalendarConfiguratorRpc,
} from "./configurator/outlook-calendar-configurator-types";
import type {
  ConfiguratorOption,
  OutlookMailConfiguratorRpc,
} from "./configurator/outlook-mail-configurator-types";
import type {
  SharePointDocumentConfiguratorRpc,
  SharePointDocumentOption,
} from "./configurator/sharepoint-document-configurator-types";

function matchesQuery(option: ConfiguratorOption, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const searchable = [option.value, option.title, option.subtitle, option.meta]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every(term => searchable.includes(term));
}

/** Narrow RPC capability exposed only to the sandboxed SharePoint URL configurator iframe. */
@validateRpc()
export class SharePointDocumentConfiguratorUI extends RpcTarget
    implements SharePointDocumentConfiguratorRpc {
  #api: SharePointApi;
  #assignedSiteUrl: string;

  constructor(getToken: AccessTokenProvider, assignedSiteUrl: string) {
    super();
    this.#api = new SharePointApi(getToken);
    this.#assignedSiteUrl = assignedSiteUrl;
  }

  async resolveDocumentUrl(url: string): Promise<SharePointDocumentOption> {
    let resource;
    let metadata;
    try {
      resource = parseSharePointDocumentResource(url);
      metadata = await this.#api.getItem(resource);
    } catch (error) {
      if (url.startsWith("https://sharepoint.microsoft.com/")) throw error;
      let resolved = await this.#api.resolveDocumentUrl(url, this.#assignedSiteUrl);
      resource = resolved.resource;
      metadata = resolved.metadata;
    }
    return {
      resourceUrl: formatSharePointDocumentResource(resource),
      title: metadata.name,
      kind: metadata.kind,
      webUrl: metadata.webUrl,
    };
  }
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
