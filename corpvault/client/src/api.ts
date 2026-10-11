// Typed RPC client for the CorpVault Express backend.
//
// Ported from the Hatch TS-space version (which used
// `createActionClient` from "@hatch/space-sdk/client"). The wire protocol
// is identical: `api.<actionName>(args)` POSTs `{action, args}` JSON to
// `/actions` and resolves with the parsed `data` payload. Errors from the
// server reject with an Error whose message is `action <name> error: <msg>`,
// matching the old client so `App.tsx` error handling works unchanged.
//
// `import type { ActionsClient }` is type-only by design: the client bundle
// never pulls in any server runtime (pg, fs, etc.).

import type { ActionsClient } from "../../server/src/actions";

function createRpcClient<T extends Record<string, (args: never) => Promise<unknown>>>(
  endpoint = "/actions",
): T {
  const callAction = async (action: string, args: unknown) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, args: args ?? {} }),
    });
    const body: unknown = await response.json().catch(() => ({}));
    const serverError =
      body && typeof body === "object" && "error" in body && body.error
        ? String(body.error)
        : null;
    if (!response.ok || serverError) {
      throw new Error(
        `action ${action} error: ${serverError ?? `HTTP ${response.status}`}`,
      );
    }
    return (body as { data?: unknown }).data;
  };
  return new Proxy({} as T, {
    get(_target, name) {
      // Symbol keys and promise-protocol names must NOT resolve to a
      // phantom action; otherwise `await client` would fire a network POST.
      if (typeof name !== "string") return undefined;
      if (name === "then" || name === "catch" || name === "finally") {
        return undefined;
      }
      return (args: unknown) => callAction(name, args);
    },
  });
}

export const api = createRpcClient<ActionsClient>();

// Re-exported for convenience so client code can do
//
//     import { api, type ApiResponse } from "./api";
//     type Workspace = ApiResponse<typeof api, "getWorkspace">;
//
// Same shape as the SDK's ApiRequest/ApiResponse helpers.
export type ApiRequest<
  C extends Record<string, (args: never) => Promise<unknown>>,
  K extends keyof C,
> = Parameters<C[K]>[0];
export type ApiResponse<
  C extends Record<string, (args: never) => Promise<unknown>>,
  K extends keyof C,
> = Awaited<ReturnType<C[K]>>;
