import { DurableObject, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import { McpAccount, McpGatekeeperImpl, GatekeeperUserImpl, GatekeeperVendor, McpVerifier } from "../src/workiq.js";
import type { McpSessionBase } from "@gadgets/mcp-shared/session";
import { WORKIQ_ENDPOINT } from "../src/policy.js";
export { default } from "../src/workiq.js";
export { McpAccount, McpGatekeeperImpl, GatekeeperUserImpl, GatekeeperVendor, McpVerifier };

class Queue extends RpcTarget {
  observations: unknown[] = [];
  actions: unknown[] = [];
  async authorizeObservation(description: unknown) { this.observations.push(description); }
  async submitAction(id: number, description: unknown) { this.actions.push({ id, description }); }
  dup() { return this; }
  [Symbol.dispose]() {}
}

export class FixtureCallback extends WorkerEntrypoint {
  async complete(_account: unknown) { return { targetOrigin: "https://workshop.example", ticket: "c".repeat(64) }; }
  async reconnectComplete(stageId: string, _expires?: Date) {
    return { targetOrigin: "https://workshop.example", ticket: stageId };
  }
  async credentialsExpired() {}
}

export class TestHooks extends DurableObject<Env> {
  async initiate(accountObjectId: string) {
    const account = this.ctx.exports.McpAccount.get(this.ctx.exports.McpAccount.idFromString(accountObjectId));
    const fixtureExports = this.ctx.exports as unknown as {
      FixtureCallback(options: object): Fetcher<unknown>;
    };
    const nonce = "a".repeat(64);
    await account.setCallback(fixtureExports.FixtureCallback({}) as never, nonce);
    return nonce;
  }
  async finish(accountObjectId: string, nonce: string, issuer: string) {
    return this.ctx.exports.McpAccount.get(this.ctx.exports.McpAccount.idFromString(accountObjectId))
      .acceptAuthCode("fixture-code", nonce, issuer);
  }

  #facet(name: string, accountObjectId: string, tools?: string[]) {
    return this.ctx.facets.get<McpGatekeeperImpl>(name, () => ({
      class: this.ctx.exports.McpGatekeeperImpl({ props: {
        accountObjectId, endpoint: WORKIQ_ENDPOINT, serverId: "workiq", serverName: "WorkIQ",
        scope: tools ? { tools } : {},
      } }),
    }));
  }

  async execute(name: string, accountObjectId: string, tool: string, args: Record<string, unknown>,
    decision: "approve" | "reject" | "pending", named: boolean, tools?: string[]) {
    const facet = this.#facet(name, accountObjectId, tools);
    const queue = new Queue();
    const session = await facet.startSession(queue as never);
    let result;
    try {
      result = named
        ? await (session as unknown as Record<string, (args: Record<string, unknown>) => ReturnType<McpSessionBase["callTool"]>>)[tool](args)
        : await session.callTool(tool, args);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    if (result.status !== "pending") return { result, observations: queue.observations, actions: queue.actions };
    if (decision === "approve") {
      try { await facet.applyAction(result.actionId); }
      catch { /* Read the durable failure through getActionResult, as the caller does. */ }
    }
    if (decision === "reject") await facet.rejectAction(result.actionId);
    return { result: await session.getActionResult(result.actionId), actions: queue.actions,
      observations: queue.observations, auto: await facet.getAutoApprovableActions() };
  }

  async catalog(name: string, accountObjectId: string, tool = "ask") {
    const facet = this.#facet(name, accountObjectId);
    const queue = new Queue();
    const session = await facet.startSession(queue as never);
    return { all: await session.listTools(), found: await session.listTools({ name: tool }),
      searched: await session.listTools({ search: tool }), types: await facet.getTypeScriptTypes(),
      observations: queue.observations.length };
  }

  async observer(name: string, accountObjectId: string) {
    try { await this.#facet(name, accountObjectId).addObserver("other", {} as never); }
    catch (error) { return error instanceof Error ? error.message : String(error); }
    return "unexpectedly accepted";
  }

  async replay(name: string, accountObjectId: string, action: number) {
    try { await this.#facet(name, accountObjectId).applyAction(action); }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
    return { ok: true };
  }
}
