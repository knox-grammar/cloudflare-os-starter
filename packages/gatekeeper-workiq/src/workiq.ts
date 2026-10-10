import { RpcStub, RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import {
  GatekeeperVendor as NativeVendor,
  McpAccount as NativeAccount,
  GatekeeperUserImpl as NativeUser,
  McpGatekeeperImpl as NativeFacet,
} from "@gadgets/mcp-gatekeeper";
export { McpVerifier } from "@gadgets/mcp-gatekeeper";
import type { ConnectedServer } from "@gadgets/mcp-shared/account";
import { McpAuthRequiredError } from "@gadgets/mcp-shared/client";
import { fetchTools } from "@gadgets/mcp-shared/connection";
import { handleMcpHttpRequest } from "@gadgets/mcp-shared/http";
import { htmlResponse, connectHandoffPageHtml, INVALID_LINK_HTML } from "@gadgets/mcp-shared/html";
import { createLogger } from "@gadgets/observability/logger";
import type { McpLogFields } from "@gadgets/mcp-shared/log";
import { sameEndpoint, requireCompleteCatalogForToolSelection } from "@gadgets/mcp-shared/scope";
import type { GatekeeperConnectCallback, GatekeeperConnectOptions,
  ResourceConfiguratorFrame, SupportedResource } from "@gadgets/workshop-shared/gatekeeper";
import type { ConfiguratorUIOption } from "@gadgets/configurator-ui";
import CONFIGURATOR from "@gadgets/mcp-gatekeeper/src/generated/server-configurator-ui.txt";
import { classifyWorkIQTool, WORKIQ_ENDPOINT } from "./policy.js";
import { registeredWorkIQProvider } from "./oauth.js";
import ROUTING from "../skill.md";

const log = createLogger<McpLogFields>({ component: "gatekeeper.workiq", vendorId: "workiq" });
const server: ConnectedServer = {
  endpoint: WORKIQ_ENDPOINT, serverId: "workiq", serverName: "Microsoft WorkIQ",
  provenance: "deployment", auth: "oauth",
};
const resource: SupportedResource = {
  urlPattern: WORKIQ_ENDPOINT, title: "Microsoft WorkIQ",
  description: "Private WorkIQ connection. All tools or a named selection; effects require approval.",
};

@validateRpc()
export class GatekeeperVendor extends NativeVendor {
  override async describe() {
    return { ...await super.describe(), displayName: "Microsoft WorkIQ", url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/",
      tagline: "Microsoft 365 through WorkIQ",
      description: "Connect your Knox WorkIQ account. Structured reads are observations. All other " +
        "tools require approval, including Copilot ask, which can delegate downstream actions. " +
        "That approval covers delegation, not a separate approval for each step inside Copilot." };
  }

  override async connectAccount(callback: Fetcher<GatekeeperConnectCallback>, options?: GatekeeperConnectOptions) {
    if (!this.env.BASE_URL || !this.env.WORKIQ_CLIENT_ID) {
      throw new Error("WorkIQ requires BASE_URL and a registered WORKIQ_CLIENT_ID.");
    }
    return super.connectAccount(callback, options);
  }

  override async getSupportedResources(): Promise<SupportedResource[]> { return [resource]; }
}

export class McpAccount extends NativeAccount {
  protected override oauthProvider(...args: Parameters<NativeAccount["oauthProvider"]>) {
    return registeredWorkIQProvider(super.oauthProvider(...args), {
      clientId: this.env.WORKIQ_CLIENT_ID ?? "", clientSecret: this.env.WORKIQ_CLIENT_SECRET,
    });
  }

  override async beginConnect(nonce: string, target: ConnectedServer | null) {
    if (target && !sameEndpoint(target.endpoint, WORKIQ_ENDPOINT)) {
      throw new Error("This connection only supports the Microsoft WorkIQ endpoint.");
    }
    if (!this.env.WORKIQ_CLIENT_ID) throw new Error("WORKIQ_CLIENT_ID is not configured.");
    return super.beginConnect(nonce, target === null ? null : server);
  }

  protected override async probe(target: ConnectedServer, token: string | null) {
    if (!sameEndpoint(target.endpoint, WORKIQ_ENDPOINT)) throw new Error("WorkIQ endpoint mismatch.");
    // Never downgrade this connection to a public endpoint if initialize happens to be public.
    if (!token) throw new McpAuthRequiredError("WorkIQ delegated sign-in required.", null);
    return super.probe(target, token);
  }
}

@validateRpc()
export class GatekeeperUserImpl extends NativeUser {
  override async getSupportedResources(): Promise<SupportedResource[]> { return [resource]; }
  override async getGatekeeperClassFor(url: string) {
    return { ...await super.getGatekeeperClassFor(url), resource };
  }

  override async startResourceConfigurator(_pattern: string): Promise<ResourceConfiguratorFrame> {
    const account = this.ctx.exports.McpAccount.get(
      this.ctx.exports.McpAccount.idFromString(this.ctx.props.accountObjectId));
    return { iframeHtml: CONFIGURATOR, ui: new RpcStub(new WorkIQConfigurator(this.env, account)) };
  }
}

@validateRpc()
class WorkIQConfigurator extends RpcTarget {
  constructor(private readonly env: Env, private readonly account: DurableObjectStub<McpAccount>) { super(); }
  async getEndpoint(): Promise<string> { return WORKIQ_ENDPOINT; }
  async listToolOptions(): Promise<ConfiguratorUIOption[]> {
    const catalog = await fetchTools(this.env, this.account, WORKIQ_ENDPOINT);
    requireCompleteCatalogForToolSelection(catalog.truncated);
    return catalog.tools.map(tool => ({ value: tool.name, title: tool.title ?? tool.name,
      subtitle: tool.name === "ask" ? "Copilot delegation can include downstream effects." : tool.description?.split(/\r?\n/)[0],
      meta: classifyWorkIQTool(tool).mode === "read" ? "read-only" : "needs approval" }));
  }
}

export class McpGatekeeperImpl extends NativeFacet {
  protected override async catalog(deadline?: number) {
    const catalog = await super.catalog(deadline);
    return { ...catalog, tools: catalog.tools.map(entry => classifyWorkIQTool(entry.tool)) };
  }
  override async searchTools(query: string) {
    return (await super.searchTools(query)).map(entry => classifyWorkIQTool(entry.tool));
  }
  override async findTool(name: string) {
    const entry = await super.findTool(name);
    return entry && classifyWorkIQTool(entry.tool);
  }
  override async describe() {
    return { ...await super.describe(), suggestedBindingName: "WORKIQ" };
  }
  override async getTypeScriptTypes() {
    return `/* WorkIQ operating guidance\n${ROUTING.replaceAll("*/", "* / ")}\n*/\n${await super.getTypeScriptTypes()}`;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!env.BASE_URL || !env.WORKIQ_CLIENT_ID) {
      return new Response("WorkIQ hosted OAuth is not configured.", { status: 503 });
    }
    return handleMcpHttpRequest(request, {
      baseUrl: env.BASE_URL,
      accountForId: id => ctx.exports.McpAccount.get(ctx.exports.McpAccount.idFromString(id)),
      log,
      connect: async (req, account, nonce) => {
        if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
        const outcome = await account.beginConnect(nonce, await account.hasEndpoint() ? null : server);
        if (outcome.kind === "invalid") return htmlResponse(INVALID_LINK_HTML, 400);
        if (outcome.kind === "redirect") return Response.redirect(outcome.url, 302);
        return htmlResponse(connectHandoffPageHtml(outcome.handoff));
      },
    });
  },
};
