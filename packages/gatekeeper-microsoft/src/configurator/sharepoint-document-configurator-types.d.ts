export type SharePointDocumentConfiguratorValues = {
  sharePointUrl?: string | null;
};

export type SharePointDocumentOption = {
  resourceUrl: string;
  title: string;
  kind: "file" | "folder";
  webUrl: string;
};

export interface SharePointDocumentConfiguratorRpc {
  resolveDocumentUrl(url: string): Promise<SharePointDocumentOption>;
}
