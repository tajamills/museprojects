// Typed RPC client for POST /actions.
//
// The original space used `createActionClient` from "@hatch/space-sdk/client",
// which POSTs `{action, args}` to `./actions`. This is the same contract over
// plain fetch: `api.<actionName>(args)` -> POST /actions, returning the parsed
// JSON response (throwing an Error when the server reports one).
//
// Types are derived from the server's action definitions — `import type`
// keeps the server runtime out of the client bundle entirely.

import type * as z from "zod";
import type { Actions } from "../../server/src/actions";

async function callAction(name: string, args: unknown): Promise<unknown> {
  const res = await fetch("/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: name, args: args ?? {} }),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body: fall through to the status check below
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

type ActionMap = typeof Actions;

export type Api = {
  [K in keyof ActionMap]: (
    args: z.input<ActionMap[K]["request"]>,
  ) => Promise<Awaited<ReturnType<ActionMap[K]["handler"]>>>;
};

export const api = new Proxy({} as Api, {
  get: (_target, name: string) => (args: unknown) => callAction(name, args),
});

// Back-compat with the SDK client's generic helper types:
//
//     import { api, type ApiResponse } from "./api";
//     type Signup = ApiResponse<"signup">;
export type ApiRequest<K extends keyof Api> = Parameters<Api[K]>[0];
export type ApiResponse<K extends keyof Api> = Awaited<ReturnType<Api[K]>>;
