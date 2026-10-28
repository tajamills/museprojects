import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

// Affiliate capture: a ?ref=CODE link stores the referral code before
// anything renders (it survives navigation to the signup form, which
// pre-fills from it) and the code is cleaned out of the address bar.
try {
  const url = new URL(window.location.href);
  const ref = url.searchParams.get("ref")?.trim().toUpperCase();
  if (ref) {
    localStorage.setItem("zepostia-ref", ref);
    url.searchParams.delete("ref");
    window.history.replaceState({}, "", url.toString());
  }
} catch {
  // Storage/URL unavailable (private mode) — capture is best-effort.
}

const queryClient = new QueryClient();

const rootEl = document.getElementById("app-root");
if (!rootEl) {
  throw new Error("missing app root element");
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
