// Holding-mode entry point. client/build.mjs bundles THIS file
// instead of main.tsx while SITE_HIDDEN is true in src/site.ts, so
// the shipped bundle contains only the holding page — none of the
// product UI is loaded or presented on any route. Flip SITE_HIDDEN
// to false and the normal entry (main.tsx) is bundled again.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HoldingPage } from "./HoldingPage";
import "./theme.css";

const rootEl = document.getElementById("app-root");
if (!rootEl) {
  throw new Error("missing app root element");
}

createRoot(rootEl).render(
  <StrictMode>
    <HoldingPage />
  </StrictMode>,
);
