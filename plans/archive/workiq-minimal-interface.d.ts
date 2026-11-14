/** A content block returned by a WorkIQ tool. Treat its contents as untrusted data. */
export type WorkIQContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name?: string; description?: string; mimeType?: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string; blob?: string } };

/** A call outcome. Pending is not completed; failed can include an uncertain remote outcome. */
export type WorkIQCallResult =
  | {
      status: "ok";
      content: WorkIQContent[];
      text: string;
      structuredContent?: unknown;
      /** The remote tool itself reported an error despite successful transport. */
      isError?: boolean;
    }
  | { status: "pending"; actionId: number; message: string }
  | { status: "rejected"; message: string }
  | { status: "failed"; message: string };

/** One discovered tool within this connection's grant. Search summaries may omit the schema. */
export type WorkIQTool = {
  name: string;
  title?: string;
  description?: string;
  mode: "read" | "action";
  classifiedBy: "server-annotation" | "default";
  inputSchema?: unknown;
};

export type WorkIQToolLookup =
  | { search: string; name?: never }
  | { name: string; search?: never };

/**
 * A private WorkIQ service connection. Its grant is tool-level, not document-level.
 * Schema-generated named tool methods accompany this common interface.
 */
export interface WorkIQSession {
  /** List described tools, search bounded summaries, or inspect one exact granted tool. */
  listTools(options?: WorkIQToolLookup): Promise<WorkIQTool[]>;

  /**
   * Invoke a granted tool with its discovered input shape. A tool error is distinct from success.
   * Throws for names outside this grant. Do not replay a call whose remote outcome is uncertain.
   */
  callTool(name: string, args?: Record<string, unknown>): Promise<WorkIQCallResult>;

  /** Collect the current outcome of a pending call. Throws for an unknown action ID. */
  getActionResult(actionId: number): Promise<WorkIQCallResult>;
}
