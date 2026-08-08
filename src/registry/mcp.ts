/**
 * JSON-RPC over MCP (Streamable HTTP). We call `tools/list` to read a real
 * agent's capability surface and `tools/call` to have it build calldata.
 *
 * MCP streamable-HTTP accepts both JSON and SSE; we request JSON so responses
 * parse directly. Endpoints may return the JSON-RPC envelope as-is.
 */

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

const client = (headers: Record<string, string> = {}) => ({
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
});

/** Fetch the live tool list from an agent's MCP endpoint. */
export async function listTools(endpoint: string): Promise<McpTool[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: client().headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`mcp ${res.status}`);
  const raw = await res.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    // Some servers emit SSE; extract the first data frame if present.
    const m = raw.match(/\ndata:\s*(.+)/);
    if (!m) throw new Error("mcp non-JSON response");
    body = JSON.parse(m[1]);
  }
  if (body.error) throw new Error(`mcp error: ${body.error.message ?? JSON.stringify(body.error)}`);
  return (body.result?.tools ?? []) as McpTool[];
}

export interface CallResult {
  content: { type: "text"; text?: string }[];
  isError?: boolean;
}

/** Ask the agent to perform a task; it returns text (usually pre-validated calldata). */
export async function callTool(
  endpoint: string,
  tool: string,
  args: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<CallResult> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: client(extraHeaders).headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`mcp call ${res.status}`);
  const raw = await res.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    const m = raw.match(/\ndata:\s*(.+)/);
    if (!m) throw new Error("mcp call non-JSON response");
    body = JSON.parse(m[1]);
  }
  if (body.error) throw new Error(`mcp call error: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result as CallResult;
}
