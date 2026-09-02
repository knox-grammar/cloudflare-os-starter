import { DurableObject, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import type { GatekeeperUserVerifier } from "@gadgets/workshop-shared/gatekeeper";
import {
  MicrosoftUserImpl,
  MicrosoftVerifier,
  SharePointDocumentGatekeeperImpl,
  UserAccount,
} from "../src/microsoft.js";

export { default } from "../src/microsoft.js";
export {
  MicrosoftUserImpl,
  MicrosoftVerifier,
  SharePointDocumentGatekeeperImpl,
  UserAccount,
};

type Props = { userObjectId: string; siteId: string; driveId: string; itemId: string };
type TestExports = {
  SharePointDocumentGatekeeperImpl(options: { props: Props }):
    DurableObjectClass<SharePointDocumentGatekeeperImpl>;
  MicrosoftVerifier(options: { props: { userObjectId: string } }): {
    hasSharePointItemAccess(siteId: string, driveId: string, itemId: string): Promise<boolean>;
  };
  MicrosoftUserImpl(options: { props: { userObjectId: string } }): {
    getGatekeeperClassFor(url: string): Promise<{ resource: { urlPattern: string } }>;
  };
  TestVerifier(options: { props: { outcome: boolean | string; deniedItemId?: string } }):
    Fetcher<{ hasSharePointItemAccess(siteId: string, driveId: string, itemId: string): Promise<boolean> }>;
};


type TestVerifierProps = { outcome: boolean | string; deniedItemId?: string };

export class TestVerifier extends WorkerEntrypoint<Env, TestVerifierProps> {
  async hasSharePointItemAccess(
    _siteId: string, _driveId: string, itemId: string,
  ): Promise<boolean> {
    if (typeof this.ctx.props.outcome === "string") throw new Error(this.ctx.props.outcome);
    return this.ctx.props.outcome && itemId !== this.ctx.props.deniedItemId;
  }
}

class TestApprovalQueue extends RpcTarget {
  readonly observations: Array<{ excludeObservers?: string[] }> = [];
  async authorizeObservation(description: { excludeObservers?: string[] }): Promise<void> {
    this.observations.push(description);
  }
  dup() { return this; }
  [Symbol.dispose]() {}
}

export class TestHooks extends DurableObject<Env> {
  #gatekeeper(name: string, props: Props) {
    const exports = this.ctx.exports as unknown as TestExports;
    return this.ctx.facets.get<SharePointDocumentGatekeeperImpl>(name, () => ({
      class: exports.SharePointDocumentGatekeeperImpl({ props }),
    }));
  }

  #verifier(outcome: boolean | string, deniedItemId?: string) {
    return (this.ctx.exports as unknown as TestExports).TestVerifier({
      props: { outcome, ...(deniedItemId ? { deniedItemId } : {}) },
    }) as unknown as Fetcher<GatekeeperUserVerifier>;
  }

  async addObserver(name: string, props: Props, outcome: boolean | string): Promise<string | null> {
    const verifier = this.#verifier(outcome);
    try {
      await this.#gatekeeper(name, props).addObserver("observer", verifier);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async readChildWithRestrictedObserver(name: string, props: Props, childItemId: string) {
    const gatekeeper = this.#gatekeeper(name, props);
    await gatekeeper.addObserver(
      "restricted-observer", this.#verifier(true, childItemId));
    const queue = new TestApprovalQueue();
    const session = await gatekeeper.startSession(
      queue as unknown as Parameters<SharePointDocumentGatekeeperImpl["startSession"]>[0]);
    const child = await session.open(childItemId);
    await child.read();
    return queue.observations;
  }

  async readChildThenAddRestrictedObserver(name: string, props: Props, childItemId: string) {
    const gatekeeper = this.#gatekeeper(name, props);
    const queue = new TestApprovalQueue();
    const session = await gatekeeper.startSession(
      queue as unknown as Parameters<SharePointDocumentGatekeeperImpl["startSession"]>[0]);
    await (await session.open(childItemId)).read();
    try {
      await gatekeeper.addObserver(
        "late-observer", this.#verifier(true, childItemId));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async actionMessage(name: string, props: Props, action: "apply" | "reject" | "revert") {
    try {
      await this.#gatekeeper(name, props)[`${action}Action`](1);
      return "did not throw";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async dispatchResult(url: string) {
    const user = (this.ctx.exports as unknown as TestExports)
      .MicrosoftUserImpl({ props: { userObjectId: "user" } });
    try {
      return { pattern: (await user.getGatekeeperClassFor(url)).resource.urlPattern };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  async verifierResult(userObjectId: string, props: Omit<Props, "userObjectId">) {
    const verifier = (this.ctx.exports as unknown as TestExports)
      .MicrosoftVerifier({ props: { userObjectId } });
    try {
      return { value: await verifier.hasSharePointItemAccess(
        props.siteId, props.driveId, props.itemId) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}
