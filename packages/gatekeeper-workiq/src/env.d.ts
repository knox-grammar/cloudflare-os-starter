declare namespace Cloudflare {
  interface Env {
    BASE_URL?: string;
    MCP_ALLOW_INSECURE?: string;
    MCP_CLIENT_NAME?: string;
    WORKIQ_CLIENT_ID?: string;
    WORKIQ_CLIENT_SECRET?: string;
  }
  interface GlobalProps {
    mainModule: typeof import("./workiq.js");
    durableNamespaces: "McpAccount" | "McpGatekeeperImpl";
  }
}
interface Env extends Cloudflare.Env {}
declare module "*.txt" { const text: string; export default text; }
declare module "*.svg" { const text: string; export default text; }
declare module "*.md" { const text: string; export default text; }
