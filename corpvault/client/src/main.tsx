// Ported from the Hatch TS-space main.tsx. The SDK's shared
// `spaceQueryClient` is replaced with a local QueryClient using the same
// conservative defaults (no window-focus refetch; bounded retry). The
// theme CSS is built separately by client/build.mjs and linked from the
// generated index.html, so this entry no longer imports "./theme.css"
// directly — esbuild cannot run the Tailwind compiler on it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("missing root element");
}

// Keep BOTH the `hatch-space-root` class AND the `data-hatch-space-root`
// attribute on the outer div; app CSS selects on them.
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="hatch-space-root" data-hatch-space-root>
        <App />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
