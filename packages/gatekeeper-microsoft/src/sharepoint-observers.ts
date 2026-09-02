import type { GatekeeperUserVerifier } from "@gadgets/workshop-shared/gatekeeper";

interface SharePointVerifier extends GatekeeperUserVerifier {
  hasSharePointItemAccess(siteId: string, driveId: string, itemId: string): Promise<boolean>;
};

type ObserverKv = Pick<DurableObjectStorage["kv"], "get" | "put" | "delete" | "list">;
type ObservedState = "pending" | "observed";

export type SharePointObservationCheck = {
  excludeObservers?: string[];
  pendingItemIds: string[];
  commit(): void;
};

/** Durable strategy-C state for independently protected items revealed through a folder binding. */
export class SharePointObserverTracker {
  constructor(
    private readonly kv: ObserverKv,
    private readonly siteId: string,
    private readonly driveId: string,
  ) {}

  #observerKey(id: string) { return `sharepointObserver:${id}`; }
  #itemKey(itemId: string) { return `sharepointObservedItem:${itemId}`; }

  #trackedItemIds(): string[] {
    const prefix = "sharepointObservedItem:";
    return [...this.kv.list<ObservedState>({ prefix })].map(([key]) => key.slice(prefix.length));
  }

  *#observers(): IterableIterator<[string, Fetcher<SharePointVerifier>]> {
    const prefix = "sharepointObserver:";
    for (const [key, verifier] of this.kv.list<Fetcher<SharePointVerifier>>({ prefix })) {
      yield [key.slice(prefix.length), verifier];
    }
  }

  async addObserver(id: string, verifier: Fetcher<SharePointVerifier>): Promise<void> {
    const checked = new Set<string>();
    while (true) {
      const itemIds = this.#trackedItemIds().filter(itemId => !checked.has(itemId));
      if (itemIds.length === 0) {
        this.kv.put(this.#observerKey(id), verifier);
        return;
      }
      const access = await Promise.all(itemIds.map(itemId =>
        verifier.hasSharePointItemAccess(this.siteId, this.driveId, itemId)));
      if (access.some(allowed => !allowed)) {
        throw new Error(
          "This collaborator cannot access a SharePoint item this workspace has read.");
      }
      for (const itemId of itemIds) checked.add(itemId);
    }
  }

  removeObserver(id: string): void {
    this.kv.delete(this.#observerKey(id));
  }

  async prepareObservation(itemIds: string[]): Promise<SharePointObservationCheck> {
    const pendingItemIds = [...new Set(itemIds)].filter(itemId =>
      this.kv.get<ObservedState>(this.#itemKey(itemId)) !== "observed");
    if (pendingItemIds.length === 0) return { pendingItemIds, commit() {} };

    for (const itemId of pendingItemIds) {
      if (this.kv.get(this.#itemKey(itemId)) === undefined) {
        this.kv.put(this.#itemKey(itemId), "pending");
      }
    }

    const access = await Promise.all([...this.#observers()].map(async ([id, verifier]) => {
      const allowed = await Promise.all(pendingItemIds.map(itemId =>
        verifier.hasSharePointItemAccess(this.siteId, this.driveId, itemId)));
      return [id, allowed.every(Boolean)] as const;
    }));
    const excluded = access.filter(([, allowed]) => !allowed).map(([id]) => id);
    return {
      ...(excluded.length ? { excludeObservers: excluded } : {}),
      pendingItemIds,
      commit: () => {
        for (const itemId of pendingItemIds) this.kv.put(this.#itemKey(itemId), "observed");
      },
    };
  }
}
