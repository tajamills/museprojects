import { useEffect, useState } from "react";

/** Client-side navigation that keeps real URLs (per-route SEO shells). */
export function go(path: string) {
  const current = window.location.pathname + window.location.search;
  if (current !== path) {
    window.history.pushState({}, "", path);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

export function useLocation(): { pathname: string; search: string } {
  const [loc, setLoc] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));
  useEffect(() => {
    const onPop = () =>
      setLoc({ pathname: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return loc;
}

/** Intercept plain left-clicks on internal links so navigation stays in-app. */
export function handleLinkClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go(href);
}
