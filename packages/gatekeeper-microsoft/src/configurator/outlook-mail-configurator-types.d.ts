export type ConfiguratorOption = {
  value: string;
  title: string;
  subtitle?: string;
  meta?: string;
}

export type OutlookMailConfiguratorValues = {
  mode?: "mailbox" | "folder" | null;
  folder?: string | null;
}

/** Narrow RPC surface exposed only to the sandboxed mail resource-picker iframe. */
export interface OutlookMailConfiguratorRpc {
  listFolders(query: string): Promise<ConfiguratorOption[]>;
}
