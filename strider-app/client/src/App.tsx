import { SafeAreaTopScrim, fileToBase64 } from "./client-helpers";
import { TermsPage, PrivacyPage } from "./legal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { api, type ApiResponse } from "./api";

type Platform = "facebook" | "instagram" | "tiktok" | "youtube" | "x";
type Page = "dashboard" | "post" | "accounts" | "billing" | "settings" | "help";
type Account = ApiResponse<typeof api, "getWorkspace">["accounts"][number];
type Post = ApiResponse<typeof api, "getWorkspace">["posts"][number];
type PlatformSetting = ApiResponse<typeof api, "listPlatformSettings">["platforms"][number];

/* ---------- Icon library: inline SVGs only, never emoji ---------- */
function BrandIcon({ path }: { path: string }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d={path} /></svg>;
}
function StrokeIcon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}
const IconFacebook = () => <BrandIcon path="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />;
const IconInstagram = () => <BrandIcon path="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />;
const IconTikTok = () => <BrandIcon path="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />;
const IconYoutube = () => <BrandIcon path="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />;
const IconX = () => <BrandIcon path="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />;
const IconHome = () => <StrokeIcon><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></StrokeIcon>;
const IconCompose = () => <StrokeIcon><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></StrokeIcon>;
const IconUsers = () => <StrokeIcon><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></StrokeIcon>;
const IconGear = () => <StrokeIcon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></StrokeIcon>;
const IconHelp = () => <StrokeIcon><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></StrokeIcon>;
const IconLogout = () => <StrokeIcon><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></StrokeIcon>;
const IconHeart = () => <StrokeIcon><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></StrokeIcon>;
const IconComment = () => <StrokeIcon><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></StrokeIcon>;
const IconShare = () => <StrokeIcon><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></StrokeIcon>;
const IconImage = () => <StrokeIcon><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></StrokeIcon>;
const IconCheck = () => <StrokeIcon><polyline points="20 6 9 17 4 12" /></StrokeIcon>;
const IconCard = () => <StrokeIcon><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></StrokeIcon>;
const IconBolt = () => <StrokeIcon><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></StrokeIcon>;
const IconClose = () => <StrokeIcon><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></StrokeIcon>;
const IconClock = () => <StrokeIcon><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></StrokeIcon>;
const IconHistory = () => <StrokeIcon><path d="M3 3v6h6" /><path d="M3.51 9a9 9 0 1 1-.49 5" /><polyline points="12 8 12 12 15.5 14" /></StrokeIcon>;
const IconPlay = () => <StrokeIcon><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16" /></StrokeIcon>;
const IconShield = () => <StrokeIcon><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 11.5 11 13.5 15 9.5" /></StrokeIcon>;
const IconChevron = () => <StrokeIcon><polyline points="6 9 12 15 18 9" /></StrokeIcon>;
const IconLink = () => <StrokeIcon><path d="M10 14a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 5.43" /><path d="M14 10a5 5 0 0 0-7.07 0L4.1 12.83a5 5 0 0 0 7.07 7.07l1.33-1.33" /></StrokeIcon>;
const IconSend = () => <StrokeIcon><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></StrokeIcon>;
const IconSearch = () => <StrokeIcon><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></StrokeIcon>;
const IconArrowRight = () => <StrokeIcon><line x1="4" y1="12" x2="20" y2="12" /><polyline points="13 5 20 12 13 19" /></StrokeIcon>;
const IconBook = () => <StrokeIcon><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" /></StrokeIcon>;
const IconMail = () => <StrokeIcon><rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="22,6 12,13 2,6" /></StrokeIcon>;
const IconExternal = () => <StrokeIcon><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></StrokeIcon>;
const IconPlaySolid = () => <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><polygon points="7 4 20 12 7 20" /></svg>;
const IconUser = () => <StrokeIcon><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></StrokeIcon>;
const IconLock = () => <StrokeIcon><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></StrokeIcon>;
const IconTrash = () => <StrokeIcon><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></StrokeIcon>;
const IconEye = () => <StrokeIcon><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></StrokeIcon>;
const IconEyeOff = () => <StrokeIcon><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></StrokeIcon>;
const IconDoc = () => <StrokeIcon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></StrokeIcon>;
/* Empty-state illustrations — same stroke family, drawn larger and lighter. */
const IconEmptyPosts = () => <StrokeIcon><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 9h8" /><path d="M8 13h5" /><path d="M16.8 15.2 13 19h5v-5l-1.2 1.2z" /></StrokeIcon>;
const IconEmptyChannels = () => <StrokeIcon><path d="M10 14a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 5.43" /><path d="M14 10a5 5 0 0 0-7.07 0L4.1 12.83a5 5 0 0 0 7.07 7.07l1.33-1.33" /></StrokeIcon>;
const IconEmptyQueue = () => <StrokeIcon><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></StrokeIcon>;

/** Logo mark with a styled "Z" fallback if the image fails to load. */
function BrandMark({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={`brand-mark-fallback ${className ?? ""}`} aria-hidden="true">Z</span>;
  return <img src="/logo-mark.png" alt="" aria-hidden="true" className={className} onError={() => setFailed(true)} />;
}

const PLATFORM_ORDER: Platform[] = ["facebook", "instagram", "tiktok", "youtube", "x"];
const PLATFORM_META: Record<Platform, { label: string; Icon: ComponentType; className: string }> = {
  facebook: { label: "Facebook", Icon: IconFacebook, className: "platform-facebook" },
  instagram: { label: "Instagram", Icon: IconInstagram, className: "platform-instagram" },
  tiktok: { label: "TikTok", Icon: IconTikTok, className: "platform-tiktok" },
  youtube: { label: "YouTube", Icon: IconYoutube, className: "platform-youtube" },
  x: { label: "X", Icon: IconX, className: "platform-x" },
};

/** One-line product description per platform, shown on the Accounts cards. */
const PLATFORM_BLURB: Record<Platform, string> = {
  facebook: "Share posts, images and videos to your Facebook Page.",
  instagram: "Publish photos, videos and Reels to your professional account.",
  tiktok: "Share videos to your TikTok account.",
  youtube: "Share videos to your YouTube channel.",
  x: "Share posts to your X account.",
};

const NAV: Array<{ id: Page; label: string; Icon: ComponentType }> = [
  { id: "dashboard", label: "Overview", Icon: IconHome },
  { id: "post", label: "Post", Icon: IconCompose },
  { id: "accounts", label: "Accounts", Icon: IconUsers },
  { id: "billing", label: "Billing", Icon: IconCard },
  { id: "settings", label: "Settings", Icon: IconGear },
  { id: "help", label: "Help", Icon: IconHelp },
];

/** URL path for each in-app view. The address bar mirrors the current
 *  view (pushState on navigation, popstate on back/forward) so a view can
 *  be reloaded or shared and land in the right place. Unknown paths fall
 *  back to the Overview. */
const PAGE_PATHS: Record<Page, string> = {
  dashboard: "/",
  post: "/post",
  accounts: "/accounts",
  billing: "/billing",
  settings: "/settings",
  help: "/help",
};

function pageFromPath(pathname: string): Page {
  const match = (Object.keys(PAGE_PATHS) as Page[]).find((page) => PAGE_PATHS[page] === pathname);
  return match ?? "dashboard";
}

/**
 * The Accounts tiles are the one source of truth for connection state:
 * a platform's channel is its visible account row — a row only counts as
 * visible when it is a real OAuth connection, or any connection while
 * the server runs in demo mode. The Overview count and the composer
 * derive from this same lookup so they can never disagree with the
 * tiles. (One row per platform is guaranteed server-side by the
 * connected_accounts unique index.)
 */
function accountForPlatform(accounts: Account[], platform: Platform, demoMode: boolean): Account | undefined {
  return accounts.find((item) => item.platform === platform && (demoMode || item.authMode === "oauth"));
}

/** The visible channel rows, in tile order — exactly what Accounts renders. */
function channelAccounts(accounts: Account[], demoMode: boolean): Account[] {
  return PLATFORM_ORDER
    .map((platform) => accountForPlatform(accounts, platform, demoMode))
    .filter((account): account is Account => Boolean(account));
}

/** Server-wide demo mode (DEMO_MODE env). Default false: demo UI chrome is hidden. */
function useServerDemoMode(): boolean {
  const config = useQuery({ queryKey: ["public-config"], queryFn: () => api.getPublicConfig({}), staleTime: 60000 });
  return config.data?.demoMode ?? false;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function PlatformBadge({ platform, small = false, large = false }: { platform: Platform; small?: boolean; large?: boolean }) {
  const meta = PLATFORM_META[platform];
  const Icon = meta.Icon;
  return <span className={`platform-badge ${meta.className} ${small ? "is-small" : ""} ${large ? "is-large" : ""}`} role="img" aria-label={meta.label}><Icon /></span>;
}

function StatusPill({ status }: { status: string }) {
  const normalized = status === "connected" || status === "published" ? "good" : status === "pending" ? "wait" : status === "cancelled" ? "muted" : "bad";
  return <span className={`status-pill status-${normalized}`}><i />{status.replace("_", " ")}</span>;
}

function EmptyState({ title, body, action, Icon = IconEmptyPosts }: { title: string; body: string; action?: React.ReactNode; Icon?: ComponentType }) {
  return <div className="empty-state"><span className="empty-art"><Icon /></span><h3>{title}</h3><p>{body}</p>{action}</div>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const demoMode = useServerDemoMode();
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("signup");
  const [message, setMessage] = useState("");
  const demo = useMutation({ mutationFn: () => api.createDemoSession({}) });
  const signup = useMutation({ mutationFn: (payload: { email: string; displayName: string; password: string }) => api.signup(payload) });
  const login = useMutation({ mutationFn: (payload: { email: string; password: string }) => api.login(payload) });
  const requestReset = useMutation({ mutationFn: (payload: { email: string }) => api.requestPasswordReset(payload) });

  const finish = (result: Awaited<ReturnType<typeof api.createDemoSession>>) => {
    setMessage(result.message);
    if (result.ok && result.sessionToken) onAuthenticated(result.sessionToken);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (mode === "signup") {
      finish(await signup.mutateAsync({
        email: String(form.get("email") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        password: String(form.get("password") ?? ""),
      }));
    } else {
      finish(await login.mutateAsync({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") }));
    }
  };

  const busy = demo.isPending || signup.isPending || login.isPending;
  const [authOpen, setAuthOpen] = useState<null | "login" | "signup">(null);
  const openAuth = (next: "login" | "signup") => { setMode(next); setMessage(""); setAuthOpen(next); };
  // Public pages (e.g. /services) send visitors here as /?auth=signup or
  // /?auth=login — open the matching auth view on arrival.
  useEffect(() => {
    const auth = new URLSearchParams(window.location.search).get("auth");
    if (auth === "login" || auth === "signup") openAuth(auth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!authOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setAuthOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authOpen]);
  return (
    <div className="landing-shell">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <header className="landing-header">
        <div className="landing-brand"><BrandMark className="brand-mark" /><strong>zepostia</strong></div>
        <nav className="landing-nav" aria-label="Primary">
          <a href="/services">Services</a>
          <a href="#how-it-works">Product</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="landing-actions">
          <button className="quiet-button" onClick={() => openAuth("login")}>Log in</button>
          <button className="primary-button" onClick={() => openAuth("signup")}>Get Started</button>
        </div>
      </header>
      <main className="landing-main">
        <section className="hero-grid">
          <div className="hero-copy">
            <span className="hero-badge">Social media, simplified</span>
            <h1>One post.<br /><em>Every channel.</em></h1>
            <p>Write once, post everywhere. Connect your Facebook, Instagram, TikTok, and YouTube accounts &mdash; plus X with an add-on &mdash; then compose and schedule from one place.</p>
            <div className="hero-ctas">
              <button className="primary-button hero-cta" onClick={() => openAuth("signup")}>Get Started</button>
              <a className="secondary-button hero-cta" href="#how-it-works">See how it works</a>
            </div>
            <ul className="trust-strip">
              <li><span className="trust-check"><IconCheck /></span>No credit card required</li>
              <li><span className="trust-check"><IconCheck /></span>Set up in minutes</li>
              <li><span className="trust-check"><IconCheck /></span>14-day free trial</li>
            </ul>
          </div>
          <div className="mockup" aria-hidden="true">
            <div className="mockup-bar"><span /><span /><span /></div>
            <div className="mockup-body">
              <div className="mockup-head"><BrandMark className="brand-mark" /><strong>zepostia</strong><span className="mockup-live">Live</span></div>
              <div className="mockup-composer">
                <p>What do you want to publish?</p>
                <div className="mockup-chips">
                  {PLATFORM_ORDER.map((platform) => <PlatformBadge key={platform} platform={platform} small />)}
                </div>
              </div>
              <div className="mockup-actions">
                <span className="mockup-btn-primary">Post now</span>
                <span className="mockup-btn">Schedule</span>
              </div>
              <div className="mockup-queue">
                <div className="mockup-row">
                  <div className="mockup-dots">
                    <PlatformBadge platform="facebook" small />
                    <PlatformBadge platform="instagram" small />
                  </div>
                  <div><p>Morning update is ready to go&hellip;</p><span>Tue 9:00 AM &middot; Scheduled</span></div>
                </div>
                <div className="mockup-row">
                  <div className="mockup-dots">
                    <PlatformBadge platform="tiktok" small />
                  </div>
                  <div><p>New video is live&hellip;</p><span>Published 2h ago</span></div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="platforms-strip" aria-label="Supported platforms">
          <span>Posts to</span>
          {PLATFORM_ORDER.map((platform) => (
            <span key={platform} className="platform-item">
              <PlatformBadge platform={platform} small />{PLATFORM_META[platform].label}
            </span>
          ))}
        </section>
        <section className="how-section" id="how-it-works">
          <h2>How it works</h2>
          <p>Three steps. No developer setup, no juggling logins.</p>
          <div className="steps-grid">
            <div className="step-card">
              <span className="step-num">1</span>
              <h3>Connect your accounts</h3>
              <p>Link each social account once with its official login. Zepostia never sees your passwords.</p>
            </div>
            <div className="step-card">
              <span className="step-num">2</span>
              <h3>Write once</h3>
              <p>Compose a single post. Zepostia adapts it to each platform&apos;s rules before it goes out.</p>
            </div>
            <div className="step-card">
              <span className="step-num">3</span>
              <h3>Schedule &amp; post</h3>
              <p>Publish right away or queue it for later. Your posts go out on time, every time.</p>
            </div>
          </div>
        </section>
        <section className="pricing-section" id="pricing">
          <h2>One plan, one price</h2>
          <div className="pricing-card">
            <div className="price">$19.88<small> / month</small></div>
            <p>All four channels: Facebook, Instagram, TikTok, YouTube. Unlimited scheduled posts. 14-day free trial &mdash; cancel anytime.</p>
            <p>X posting available as a paid add-on &mdash; see <a href="/services">Services</a>.</p>
            <button className="primary-button hero-cta" onClick={() => openAuth("signup")}>Get Started</button>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <div className="footer-brand"><BrandMark className="brand-mark" /><strong>zepostia</strong></div>
        <p>&copy; 2026 zepostia. All rights reserved.</p>
        <nav aria-label="Footer"><a href="/services">Services</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav>
      </footer>
      {authOpen && <div className="auth-modal" role="dialog" aria-modal="true" aria-label="zepostia account access">
        <div className="auth-modal-backdrop" onClick={() => setAuthOpen(null)} />
        <section className="auth-panel auth-modal-card">
          <button className="modal-close" onClick={() => setAuthOpen(null)} aria-label="Close"><IconClose /></button>
          {demoMode && <div className="demo-ribbon">DEMO / TEST MODE</div>}
          {mode === "forgot" ? <>
            <h2 className="auth-modal-title">Reset your password</h2>
            <p className="auth-note">Enter the email you signed up with. If it has an account, a reset link good for 1 hour will be sent to it.</p>
            <form onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const result = await requestReset.mutateAsync({ email: String(form.get("email") ?? "") });
              setMessage(result.message);
            }}>
              <label>Email<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
              <button className="primary-button wide" type="submit" disabled={requestReset.isPending}>{requestReset.isPending ? "Sending…" : "Send reset link"}</button>
            </form>
            <button className="text-button back-link" onClick={() => { setMode("login"); setMessage(""); }}>Back to sign in</button>
          </> : <>
            <div className="auth-tabs" role="tablist" aria-label="Account access mode">
              <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")} role="tab" aria-selected={mode === "signup"}>Create account</button>
              <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} role="tab" aria-selected={mode === "login"}>Sign in</button>
            </div>
            <form onSubmit={submit}>
              {mode === "signup" && <label>Display name<input name="displayName" autoComplete="name" required minLength={2} placeholder="Your name" /></label>}
              <label>Email<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
              <label>Password<input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 8 : 1} placeholder="At least 8 characters" /></label>
              <button className="primary-button wide" type="submit" disabled={busy}>{busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}</button>
            </form>
            {mode === "login" && <button className="text-button forgot-link" onClick={() => { setMode("forgot"); setMessage(""); }}>Forgot password?</button>}
          </>}
          {message && <p className="form-message" role="status">{message}</p>}
          {demoMode && <><div className="or-rule"><span>or</span></div>
          <button className="secondary-button wide" disabled={busy} onClick={async () => finish(await demo.mutateAsync())}>Enter a fresh demo workspace</button></>}
          <p className="auth-note">Sign in with your zepostia account.</p>
        </section>
      </div>}
    </div>
  );
}

function ResetPasswordPage() {
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const reset = useMutation({ mutationFn: (payload: { token: string; password: string }) => api.resetPassword(payload) });
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (password !== confirm) { setMessage("The two passwords don't match."); return; }
    const result = await reset.mutateAsync({ token, password });
    setMessage(result.message);
    if (result.ok) setDone(true);
  };
  return (
    <div className="landing-shell">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <header className="landing-header">
        <div className="landing-brand"><a href="/" className="brand-home" aria-label="zepostia home"><BrandMark className="brand-mark" /><strong>zepostia</strong></a></div>
      </header>
      <main className="landing-main reset-main">
        <section className="auth-panel reset-card">
          <h1>Set a new password</h1>
          {done ? <>
            <p className="form-message" role="status">{message}</p>
            <a className="primary-button wide" href="/">Sign in</a>
          </> : <>
            <form onSubmit={submit}>
              <label>New password<input name="password" type="password" autoComplete="new-password" required minLength={8} placeholder="At least 8 characters" /></label>
              <label>Confirm password<input name="confirm" type="password" autoComplete="new-password" required minLength={8} placeholder="Repeat your new password" /></label>
              <button className="primary-button wide" type="submit" disabled={reset.isPending}>{reset.isPending ? "Saving…" : "Set new password"}</button>
            </form>
            {message && <p className="form-message" role="status">{message}</p>}
          </>}
        </section>
      </main>
    </div>
  );
}

function Dashboard({ accounts, posts, go, xVisible }: { accounts: Account[]; posts: Post[]; go: (page: Page) => void; xVisible: boolean }) {
  const demoMode = useServerDemoMode();
  // Count exactly what the Accounts tiles show: the visible channel rows
  // (same lookup, same X gating), tallied by their current status.
  const channels = channelAccounts(accounts, demoMode).filter((account) => account.platform !== "x" || xVisible);
  const connected = channels.filter((account) => account.status === "connected").length;
  const pending = posts.filter((post) => post.status === "pending").length;
  const published = posts.filter((post) => post.status === "published").length;
  const needsAttention = channels.filter((account) => account.status !== "connected");
  return <div className="page-stack">
    <div className="page-heading-row">
      <div className="page-heading"><h1>Overview</h1><p>Manage your posts and track your content performance.</p></div>
      <button className="primary-button" onClick={() => go("post")}><span className="btn-plus" aria-hidden="true">+</span>Create post</button>
    </div>

    {connected > 0 ? <section className="connected-band">
      <span className="band-bolt"><IconBolt /></span>
      <div className="band-text"><strong>{connected === 1 ? "1 channel connected" : `${connected} channels connected`}</strong><span>Write once, publish everywhere.</span></div>
      <button className="secondary-button band-action" onClick={() => go("accounts")}>Manage accounts<span className="btn-arrow"><IconArrowRight /></span></button>
    </section> : <section className="dash-hero">
      <div><h1>Connect your first channel</h1><p>Connect your social accounts to start publishing.</p></div>
      <button className="primary-button" onClick={() => go("accounts")}>Connect channels</button>
    </section>}

    {needsAttention.length > 0 && <section className="attention-band"><strong>{needsAttention.length} account{needsAttention.length === 1 ? "" : "s"} need attention</strong><span>Reconnect before publishing. The app will not fail silently.</span><button onClick={() => go("accounts")}>Review</button></section>}

    <section className="stat-tiles" aria-label="Workspace summary">
      <div className="stat-tile"><span className="stat-bubble tint-green"><IconLink /></span><div><strong>{connected}<small>/5</small></strong><span>connected</span></div></div>
      <div className="stat-tile"><span className="stat-bubble tint-slate"><IconClock /></span><div><strong>{pending}</strong><span>queued</span></div></div>
      <div className="stat-tile"><span className="stat-bubble tint-accent"><IconSend /></span><div><strong>{published}</strong><span>published</span></div></div>
    </section>

    <section className="content-section">
      <div className="section-heading"><div><h2>Recent posts</h2></div><button className="text-button arrow-link" onClick={() => go("post")}>Open posts<span className="btn-arrow"><IconArrowRight /></span></button></div>
      {posts.length === 0 ? <EmptyState Icon={IconEmptyPosts} title="No posts yet" body="Your first publish or scheduled post will appear here." action={<button className="secondary-button" onClick={() => go("post")}>Open composer</button>} /> : <PostList posts={posts.slice(0, 5)} />}
    </section>
  </div>;
}

function PostList({ posts, onCancel, onCancelBump, onAdvanceBump, cancelling }: { posts: Post[]; onCancel?: (id: number) => void; onCancelBump?: (id: number) => void; onAdvanceBump?: (id: number) => void; cancelling?: boolean }) {
  const demoMode = useServerDemoMode();
  return <div className="post-list">{posts.map((post) => <article className="post-row" key={post.id}>
    <div className="post-main">
    <div className="post-topline"><StatusPill status={post.status} /><time>{post.publishMode === "scheduled" ? formatDate(post.scheduledAt) : formatDate(post.createdAt)}</time></div>
    {post.youtubeTitle && <h3>{post.youtubeTitle}</h3>}
    <p>{post.body || <span className="dim-text">Media-only post</span>}</p>
    {post.mediaName && <div className="media-chip"><IconImage />{post.mediaName}</div>}
    <div className="target-row">{post.targets.map((target, index) => <span key={`${post.id}-${target.platform}-${index}`} title={`${PLATFORM_META[target.platform].label}: ${target.status}`}><PlatformBadge platform={target.platform} small /><i className={`target-dot target-${target.status}`} /></span>)}</div>
    </div>
    {post.mediaUrl && <div className="post-thumb" aria-hidden="true">{post.mediaType?.startsWith("video") ? <video src={post.mediaUrl} preload="metadata" muted playsInline /> : <img src={post.mediaUrl} alt="" loading="lazy" />}</div>}
    {post.bumpComments.length > 0 && <details className="bump-plan">
      <summary><span><i className={post.bumpEnabled ? "pulse-dot" : ""} />24-hour bump plan</span><strong>{post.bumpComments.filter((comment) => comment.status === "published").length}/{post.bumpComments.length} sent</strong><span className="summary-chev"><IconChevron /></span></summary>
      <ol>{post.bumpComments.map((comment) => <li key={comment.id} className={`bump-${comment.status}`}>
        <span>{comment.status === "published" ? "Sent" : comment.status === "cancelled" ? "Stopped" : comment.status === "failed" ? "Failed" : comment.jobs.length > 0 ? `Slot ${comment.sequence}` : formatDate(comment.scheduledAt)}</span>
        <div className="bump-comment-body">
          <p>{comment.body}</p>
          {comment.status === "failed" && comment.errorMessage && <p className="bump-error">{comment.errorMessage}</p>}
          {comment.jobs.length > 0 && <ul className="bump-jobs">{comment.jobs.map((job) => <li key={job.id} className={`bump-job-${job.status}`}>
            <span className="bump-job-platform">{PLATFORM_META[job.platform].label}</span>
            <span>{job.status === "published" ? `Sent ${formatDate(job.publishedAt)}` : job.status === "failed" ? `Failed${job.errorMessage ? ` — ${job.errorMessage}` : ""}` : job.status === "cancelled" ? "Stopped" : `Scheduled ${formatDate(job.scheduledAt)}`}</span>
          </li>)}</ul>}
        </div>
      </li>)}</ol>
      {post.bumpEnabled && post.bumpComments.some((comment) => comment.status === "pending") && <div className="bump-actions">
        {onAdvanceBump && <button className="secondary-button" disabled={cancelling} onClick={() => onAdvanceBump(post.id)}>{demoMode ? "Run next demo comment" : "Run next comment"}</button>}
        {onCancelBump && <button className="danger-text" disabled={cancelling} onClick={() => onCancelBump(post.id)}>Stop remaining comments</button>}
      </div>}
    </details>}
    {post.status === "pending" && onCancel && <button className="danger-text" disabled={cancelling} onClick={() => onCancel(post.id)}>Cancel scheduled post</button>}
  </article>)}</div>;
}

function Composer({ accounts, token, onDone, goAccounts }: { accounts: Account[]; token: string; onDone: (message: string) => void; goAccounts: () => void }) {
  const demoMode = useServerDemoMode();
  const queryClient = useQueryClient();
  const connected = channelAccounts(accounts, demoMode).filter((account) => account.status === "connected");
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [preview, setPreview] = useState<Platform>(connected[0]?.platform ?? "facebook");
  const [bumpOn, setBumpOn] = useState(false);
  const [bumpTexts, setBumpTexts] = useState<string[]>(["", "", "", ""]);
  const [message, setMessage] = useState("");
  const objectUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  const selectedAccounts = connected.filter((account) => selected.includes(account.id));
  const selectedPlatforms = selectedAccounts.map((account) => account.platform);
  const bumpFilled = bumpTexts.filter((text) => text.trim().length > 0).length;
  const bumpUnsupported = selectedPlatforms.filter((platform) => platform === "tiktok");
  const requirements = [
    selectedPlatforms.includes("x") && body.length > 280 ? `X is ${body.length - 280} characters over its limit.` : null,
    (selectedPlatforms.includes("instagram") || selectedPlatforms.includes("tiktok")) && !file ? "Instagram and TikTok require media." : null,
    selectedPlatforms.includes("youtube") && (!file?.type.startsWith("video/") || !title.trim()) ? "YouTube requires a video and title." : null,
    mode === "scheduled" && !scheduledAt ? "Choose a date and time." : null,
    bumpOn && bumpFilled === 0 ? "Add at least one follow-up comment, or turn the bump off." : null,
    bumpOn && selectedPlatforms.length > 0 && selectedPlatforms.every((platform) => platform === "tiktok") ? "Follow-up comments aren't available for TikTok yet. Pick another channel or turn the bump off." : null,
    bumpOn && selectedPlatforms.includes("x") && bumpTexts.some((text) => text.trim().length > 280) ? "A follow-up comment is over X's 280-character limit." : null,
  ].filter(Boolean) as string[];

  const publish = useMutation({
    mutationFn: async () => {
      const encoded = file ? await fileToBase64(file) : null;
      return api.createPost({
        sessionToken: token,
        body,
        youtubeTitle: title || undefined,
        accountIds: selected,
        publishMode: mode,
        scheduledAt: mode === "scheduled" && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        bumpComments: bumpOn && bumpFilled > 0 ? bumpTexts.map((text) => text.trim()) : undefined,
        media: encoded && file ? { name: file.name, mimeType: encoded.mimeType, dataBase64: encoded.dataBase64 } : undefined,
      });
    },
    onSuccess: async (result) => {
      setMessage(result.message);
      if (result.ok) {
        setBody(""); setTitle(""); setSelected([]); setFile(null); setScheduledAt(""); setMode("now");
        setBumpOn(false); setBumpTexts(["", "", "", ""]);
        await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
        onDone(result.message);
      }
    },
  });

  const toggle = (id: number) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <div className="page-stack composer-page">
    <div className="page-heading"><h1>New post</h1><p>Write once, preview each platform, then post now or schedule it.</p></div>
    {connected.length === 0 ? <EmptyState Icon={IconEmptyChannels} title="No channels connected" body={demoMode ? "Run a demo OAuth connection first. No platform passwords are ever requested." : "Connect a channel first. No platform passwords are ever requested."} action={<button className="primary-button" onClick={goAccounts}>Connect a channel</button>} /> : <>
      <section className="composer-grid">
        <div className="composer-card">
        <div className="compose-form">
          <label className="field-label">Post text <span className={body.length > 280 && selectedPlatforms.includes("x") ? "limit-bad" : ""}>{body.length}{selectedPlatforms.includes("x") ? "/280 for X" : " characters"}</span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={7} placeholder="What do you want to publish?" />
          </label>
          {selectedPlatforms.includes("youtube") && <label className="field-label">YouTube title <span>{title.length}/100</span><input value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="Required for YouTube" /></label>}
          <label className="upload-zone">
            <input aria-label="Upload image or video" type="file" accept="image/*,video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <span className="upload-icon"><IconImage /></span>
            <strong>Media</strong>
            <span>{file ? file.name : "Choose image or video · max 12 MB"}</span>
          </label>
          <fieldset className="target-fieldset"><legend>Publish to</legend><div className="target-options">{connected.map((account) => <label key={account.id} className={selected.includes(account.id) ? "target-option active" : "target-option"}>
            <input type="checkbox" checked={selected.includes(account.id)} onChange={() => toggle(account.id)} />
            <PlatformBadge platform={account.platform} /><span><strong>{PLATFORM_META[account.platform].label}</strong><small>{account.handle}</small></span>
          </label>)}</div></fieldset>
          <div className="bump-builder">
            <div className="bump-toggle-row">
              <div>
                <strong>Keep this post moving for 24 hours</strong>
                <p>Stagger four comments at +1h, +6h, +12h, and +23h.</p>
                {bumpOn && bumpUnsupported.length > 0 && selectedPlatforms.length > bumpUnsupported.length && <p className="bump-note">Not available for {bumpUnsupported.map((platform) => PLATFORM_META[platform].label).join(", ")} yet — the other channels still get their comments.</p>}
              </div>
              <button type="button" role="switch" aria-checked={bumpOn} aria-label="Keep this post moving for 24 hours" className={bumpOn ? "bump-toggle on" : "bump-toggle"} onClick={() => setBumpOn((current) => !current)}><span /></button>
            </div>
            {bumpOn && <div className="bump-fields">
              {["+1 hour", "+6 hours", "+12 hours", "+23 hours"].map((label, index) => <label className="field-label" key={label}>{label}
                <span>{bumpTexts[index].length}/500{selectedPlatforms.includes("x") && bumpTexts[index].trim().length > 280 ? " · over X's 280 limit" : ""}</span>
                <textarea
                  value={bumpTexts[index]}
                  maxLength={500}
                  rows={2}
                  placeholder="Write a follow-up comment (optional)"
                  onChange={(event) => setBumpTexts((current) => current.map((text, i) => i === index ? event.target.value : text))}
                />
              </label>)}
            </div>}
          </div>
          {mode === "scheduled" && <label className="field-label">Publish date and time<input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>}
          {requirements.length > 0 && <div className="requirements" role="status">{requirements.map((item) => <p key={item}>{item}</p>)}</div>}
          {message && <p className="form-message" role="status">{message}</p>}
          <div className="compose-actions">
            {mode === "now" ? <>
              <button className="primary-button" disabled={publish.isPending || selected.length === 0 || requirements.length > 0} onClick={() => publish.mutate()}>{publish.isPending ? "Preparing…" : "Post now"}</button>
              <button className="secondary-button" disabled={publish.isPending} onClick={() => setMode("scheduled")}>Schedule</button>
            </> : <>
              <button className="primary-button" disabled={publish.isPending || selected.length === 0 || requirements.length > 0} onClick={() => publish.mutate()}>{publish.isPending ? "Preparing…" : "Add to queue"}</button>
              <button className="secondary-button" disabled={publish.isPending} onClick={() => setMode("now")}>Post now instead</button>
            </>}
          </div>
          {demoMode ? <p className="demo-action-note">Demo mode simulates the final official API response and never contacts an external account.</p> : <p className="demo-action-note">Posts go out through the accounts connected on the Accounts page.</p>}
        </div>
        </div>

        <aside className="preview-panel">
          <div className="preview-topbar">
            <div className="preview-tabs" role="tablist" aria-label="Platform preview">{PLATFORM_ORDER.filter((platform) => connected.some((account) => account.platform === platform)).map((platform) => <button key={platform} className={preview === platform ? "active" : ""} onClick={() => setPreview(platform)} role="tab" aria-selected={preview === platform}><PlatformBadge platform={platform} small /></button>)}</div>
            <label className="preview-switcher"><span className="sr-only">Preview platform</span><select value={preview} onChange={(event) => setPreview(event.target.value as Platform)}>{PLATFORM_ORDER.filter((platform) => connected.some((account) => account.platform === platform)).map((platform) => <option key={platform} value={platform}>{PLATFORM_META[platform].label}</option>)}</select></label>
          </div>
          <div className={`platform-preview preview-${preview}`}>
            <div className="preview-account"><PlatformBadge platform={preview} /><div><strong>{connected.find((account) => account.platform === preview)?.handle ?? PLATFORM_META[preview].label}</strong><small>Sponsored nowhere · {demoMode ? "demo preview" : "preview"}</small></div></div>
            {preview === "youtube" && <h3>{title || "Your video title"}</h3>}
            {file && objectUrl ? file.type.startsWith("video/") ? <video src={objectUrl} controls preload="metadata" /> : <img src={objectUrl} alt="Selected upload preview" /> : <div className="preview-media-empty"><span className="preview-media-icon"><IconImage /></span>{preview === "instagram" || preview === "tiktok" || preview === "youtube" ? "Media required" : "Media preview"}</div>}
            <p>{preview === "x" ? body.slice(0, 280) : body || "Your post will appear here."}</p>
            <div className="preview-chrome"><span><IconHeart /></span><span><IconComment /></span><span><IconShare /></span></div>
          </div>
        </aside>
      </section>
    </>}
  </div>;
}

function FacebookPagePicker({ token, onMessage }: { token: string; onMessage: (message: string) => void }) {
  const queryClient = useQueryClient();
  const pages = useQuery({ queryKey: ["fb-pages", token], queryFn: () => api.listFacebookPages({ sessionToken: token }) });
  const select = useMutation({
    mutationFn: (pageId: string) => api.selectFacebookPage({ sessionToken: token, pageId }),
    onSuccess: async (result) => {
      onMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
      await queryClient.invalidateQueries({ queryKey: ["fb-pages", token] });
    },
  });
  if (!pages.data?.ok || (pages.data.pages?.length ?? 0) < 2) return null;
  return <label className="page-picker"><span>Posting as</span><select
    aria-label="Facebook Page"
    value={pages.data.selectedPageId ?? ""}
    disabled={select.isPending}
    onChange={(event) => select.mutate(event.target.value)}
  >{pages.data.pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}</select></label>;
}

function InstagramAccountPicker({ token, onMessage }: { token: string; onMessage: (message: string) => void }) {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["ig-accounts", token], queryFn: () => api.listInstagramAccounts({ sessionToken: token }) });
  const select = useMutation({
    mutationFn: (igUserId: string) => api.selectInstagramAccount({ sessionToken: token, igUserId }),
    onSuccess: async (result) => {
      onMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
      await queryClient.invalidateQueries({ queryKey: ["ig-accounts", token] });
    },
  });
  if (!accounts.data?.ok || (accounts.data.accounts?.length ?? 0) < 2) return null;
  return <label className="page-picker"><span>Posting as</span><select
    aria-label="Instagram account"
    value={accounts.data.selectedIgUserId ?? ""}
    disabled={select.isPending}
    onChange={(event) => select.mutate(event.target.value)}
  >{accounts.data.accounts.map((account) => <option key={account.igUserId} value={account.igUserId}>@{account.username} · {account.pageName}</option>)}</select></label>;
}

function Accounts({ accounts, settings, token, onMessage, xVisible, xNeedsTier, goBilling, goHelp }: { accounts: Account[]; settings: PlatformSetting[]; token: string; onMessage: (message: string) => void; xVisible: boolean; xNeedsTier: boolean; goBilling: () => void; goHelp: () => void }) {
  const demoMode = useServerDemoMode();
  const queryClient = useQueryClient();
  const [busyPlatform, setBusyPlatform] = useState<Platform | null>(null);
  const [manageOpen, setManageOpen] = useState<Platform | null>(null);
  // OAuth popup flow: Connect opens the platform auth page in a popup.
  // The popup posts a "zepostia-oauth" message on completion and closes
  // itself; we refresh the connection list without a full page reload.
  useEffect(() => {
    const onOAuthMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; platform?: string; ok?: boolean; message?: string; reason?: string } | null;
      if (!data || data.type !== "zepostia-oauth") return;
      if (data.ok) onMessage(data.message || "Account connected.");
      else onMessage(`Connection failed: ${data.reason || "unknown error"}`);
      await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
    };
    window.addEventListener("message", onOAuthMessage);
    return () => window.removeEventListener("message", onOAuthMessage);
  }, [queryClient, token, onMessage]);
  const openOAuthPopup = (authUrl: string): void => {
    const popup = window.open(authUrl, "zepostia-oauth", "width=600,height=700,menubar=no,toolbar=no,location=yes");
    if (!popup) {
      // Popup blocked — fall back to a full-page redirect.
      window.location.href = authUrl;
      return;
    }
    // If the user closes the popup manually (completed or abandoned),
    // refresh the connection list so the UI reflects the current state.
    const timer = window.setInterval(async () => {
      if (popup.closed) {
        window.clearInterval(timer);
        await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
      }
    }, 500);
  };
  const connect = useMutation({
    mutationFn: (platform: Platform) => api.connectDemoAccount({ sessionToken: token, platform }),
    onSuccess: async (result) => { onMessage(result.message); await queryClient.invalidateQueries({ queryKey: ["workspace", token] }); },
    onSettled: () => setBusyPlatform(null),
  });
  const connectFb = useMutation({
    mutationFn: () => api.connectFacebook({ sessionToken: token }),
    onSuccess: async (result) => {
      if (result.ok && result.mode === "oauth" && result.authUrl) {
        openOAuthPopup(result.authUrl);
        return;
      }
      onMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
    },
    onSettled: () => setBusyPlatform(null),
  });
  const connectIg = useMutation({
    mutationFn: () => api.connectInstagram({ sessionToken: token }),
    onSuccess: async (result) => {
      if (result.ok && result.mode === "oauth" && result.authUrl) {
        openOAuthPopup(result.authUrl);
        return;
      }
      onMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
    },
    onSettled: () => setBusyPlatform(null),
  });
  const connectTt = useMutation({
    mutationFn: () => api.connectTikTok({ sessionToken: token }),
    onSuccess: async (result) => {
      if (result.ok && result.mode === "oauth" && result.authUrl) {
        openOAuthPopup(result.authUrl);
        return;
      }
      onMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
    },
    onSettled: () => setBusyPlatform(null),
  });
  const connectYt = useMutation({
    mutationFn: () => api.connectYoutube({ sessionToken: token }),
    onSuccess: async (result) => {
      if (result.ok && result.mode === "oauth" && result.authUrl) {
        openOAuthPopup(result.authUrl);
        return;
      }
      onMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
    },
    onSettled: () => setBusyPlatform(null),
  });
  const connectX = useMutation({
    mutationFn: () => api.connectX({ sessionToken: token }),
    onSuccess: async (result) => {
      if (result.ok && result.mode === "oauth" && result.authUrl) {
        openOAuthPopup(result.authUrl);
        return;
      }
      onMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
    },
    onSettled: () => setBusyPlatform(null),
  });
  const disconnect = useMutation({
    mutationFn: (accountId: number) => api.disconnectAccount({ sessionToken: token, accountId }),
    onSuccess: async (result) => { onMessage(result.message); await queryClient.invalidateQueries({ queryKey: ["workspace", token] }); },
  });
  return <div className="page-stack">
    <div className="page-heading-row">
      <div className="page-heading"><h1>Accounts</h1><p>Connect your social media accounts to publish content from Zepostia.</p></div>
      <button className="help-pill" onClick={goHelp}><span className="help-pill-icon"><IconHelp /></span>Having trouble connecting?</button>
    </div>
    <div className="connect-list">{PLATFORM_ORDER.filter((platform) => platform !== "x" || xVisible).map((platform) => {
      const meta = PLATFORM_META[platform];
      const setting = settings.find((item) => item.platform === platform);
      const account = accountForPlatform(accounts, platform, demoMode);
      const needsReconnect = account && account.status !== "connected";
      const isFacebook = platform === "facebook";
      const isInstagram = platform === "instagram";
      const isTiktok = platform === "tiktok";
      const isYoutube = platform === "youtube";
      const isX = platform === "x";
      const connectBusy = busyPlatform === platform;
      const startConnect = () => { setBusyPlatform(platform); if (isFacebook) connectFb.mutate(); else if (isInstagram) connectIg.mutate(); else if (isTiktok) connectTt.mutate(); else if (isYoutube) connectYt.mutate(); else if (isX) connectX.mutate(); else connect.mutate(platform); };
      const connectLabel = connectBusy ? "Connecting…" : demoMode ? "Run demo OAuth" : "Connect";
      const managing = manageOpen === platform;
      return <article className="connect-row" key={platform}>
        <div className="connect-card-top">
          <PlatformBadge platform={platform} large />
          <div className="connect-card-main">
            <div className="connect-name-row"><h2>{meta.label}{isX && xNeedsTier && <span className="status-pill status-accent addon-pill"><IconBolt />Requires add-on</span>}</h2></div>
            {account && <p className="connect-handle"><strong>{account.handle}</strong><span className="handle-ext"><IconExternal /></span>{account.authMode === "oauth" && <span className="auth-mode-tag">live</span>}</p>}
            <p>{isX && xNeedsTier ? "X posting is an add-on. Add a tier on the Billing page, then connect here." : PLATFORM_BLURB[platform]}</p>
            {setting?.warning && !(isX && xNeedsTier) && <p className="connect-note">{setting.warning}</p>}
          </div>
          <div className="connect-card-side">
            {account ? <span className="connect-pills"><StatusPill status={account.status} />{isTiktok && account.status === "connected" && <span className="status-pill status-accent"><IconBolt />Publishing enabled</span>}</span> : <span className="status-pill status-muted"><i />Not connected</span>}
            {account
              ? needsReconnect
                ? <button className="warning-button" onClick={startConnect}>Reconnect</button>
                : <button className="secondary-button" aria-expanded={managing} onClick={() => setManageOpen(managing ? null : platform)}>Manage</button>
              : isX && xNeedsTier
                ? <button className="secondary-button" onClick={goBilling}>Get the X add-on</button>
                : <button className="primary-button connect-btn" disabled={connect.isPending || connectFb.isPending || connectIg.isPending || connectTt.isPending || connectYt.isPending || connectX.isPending} onClick={startConnect}><span className="btn-link-icon"><IconLink /></span>{connectLabel}</button>}
          </div>
        </div>
        {account && managing && !needsReconnect && <div className="connect-manage">
          {isFacebook && account.authMode === "oauth" && <FacebookPagePicker token={token} onMessage={onMessage} />}
          {isInstagram && account.authMode === "oauth" && <InstagramAccountPicker token={token} onMessage={onMessage} />}
          <button className="danger-text" disabled={disconnect.isPending} onClick={() => disconnect.mutate(account.id)}>Disconnect this account</button>
        </div>}
        <details><summary><span className="summary-chev lead"><IconChevron /></span>If connecting fails</summary><p>{isX && xNeedsTier ? "X connects once your workspace has an X add-on tier — add one on the Billing page." : setting?.failureHint ?? "Review the platform setup in Settings and try again."}</p></details>
      </article>;
    })}</div>
    <button className="accounts-help-banner" onClick={goHelp}>
      <span className="banner-book"><IconBook /></span>
      <span className="banner-text"><strong>Need help connecting your accounts?</strong><span>View step-by-step guides for each platform.</span></span>
      <span className="banner-link">View help center<span className="handle-ext"><IconExternal /></span></span>
    </button>
  </div>;
}

function Queue({ posts, token, onMessage, embedded }: { posts: Post[]; token: string; onMessage: (message: string) => void; embedded?: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "pending" | "published" | "failed">("all");
  const cancel = useMutation({
    mutationFn: (postId: number) => api.cancelPost({ sessionToken: token, postId }),
    onSuccess: async (result) => { onMessage(result.message); await queryClient.invalidateQueries({ queryKey: ["workspace", token] }); },
  });
  const cancelBump = useMutation({
    mutationFn: (postId: number) => api.cancelBumpPlan({ sessionToken: token, postId }),
    onSuccess: async (result) => { onMessage(result.message); await queryClient.invalidateQueries({ queryKey: ["workspace", token] }); },
  });
  const advanceBump = useMutation({
    mutationFn: (postId: number) => api.advanceBumpDemo({ sessionToken: token, postId }),
    onSuccess: async (result) => { onMessage(result.message); await queryClient.invalidateQueries({ queryKey: ["workspace", token] }); },
  });
  const filtered = filter === "all" ? posts : posts.filter((post) => post.status === filter);
  return <div className={embedded ? "queue-embedded" : "page-stack"}>
    {!embedded && <div className="page-heading"><h1>Queue</h1><p>Scheduled posts waiting to go out. Cancel anything before it publishes.</p></div>}
    {embedded && <div className="section-heading"><div><h2>Queued and past posts</h2></div></div>}
    <div className="filter-row" role="group" aria-label="Filter posts">{(["all", "pending", "published", "failed"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {filtered.length === 0 ? <EmptyState Icon={IconEmptyQueue} title={filter === "all" ? "Queue is empty" : `No ${filter} posts`} body="Posts you publish or schedule will land here with per-platform status." /> : <PostList posts={filtered} onCancel={(id) => cancel.mutate(id)} onCancelBump={(id) => cancelBump.mutate(id)} onAdvanceBump={(id) => advanceBump.mutate(id)} cancelling={cancel.isPending || cancelBump.isPending || advanceBump.isPending} />}
  </div>;
}

function PostPage({ accounts, posts, token, onMessage, goAccounts, xVisible }: { accounts: Account[]; posts: Post[]; token: string; onMessage: (message: string) => void; goAccounts: () => void; xVisible: boolean }) {
  const visibleAccounts = xVisible ? accounts : accounts.filter((account) => account.platform !== "x");
  return <div className="page-stack post-page">
    <Composer accounts={visibleAccounts} token={token} onDone={onMessage} goAccounts={goAccounts} />
    <Queue posts={posts} token={token} onMessage={onMessage} embedded />
  </div>;
}

function MetaPlatformCard({ setting, isAdmin, metaConfigured, token, onMessage }: { setting: PlatformSetting; isAdmin: boolean; metaConfigured: boolean; token: string; onMessage: (message: string) => void }) {
  const test = useMutation({
    mutationFn: () => api.testMetaCredentials({ sessionToken: token }),
    onSuccess: (result) => onMessage(result.message),
  });
  const steps = setting.platform === "facebook"
    ? ["Hit Connect on the Accounts page.", "Log in with Facebook and approve zepostia.", "Choose the Pages you want zepostia to post to."]
    : ["Switch your Instagram to a professional account (creator or business) in the Instagram app.", "Link that Instagram account to one of your Facebook Pages (Page settings → Linked accounts).", "Then hit Connect on the Accounts page and approve zepostia."];
  return <details className="settings-card" open>
    <summary><span><PlatformBadge platform={setting.platform} /><strong>{setting.label}</strong></span><span>No setup needed</span><span className="summary-chev"><IconChevron /></span></summary>
    <div className="settings-body">

      {isAdmin && <div className="go-live-list">{steps.map((step, i) => <p key={i}><b>{i + 1}</b><span>{step}</span></p>)}</div>}
      {isAdmin && <p className="secret-note">Owner Meta app: {metaConfigured ? "configured" : "not configured — set FACEBOOK_APP_ID and FACEBOOK_CLIENT_SECRET on the server"}.</p>}
      {isAdmin && setting.platform === "facebook" && <button className="secondary-button" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? "Testing…" : "Test Meta connection"}</button>}
      {isAdmin && setting.platform === "facebook" && <p className="secret-note"><a href="/facebook-setup-tutorial.mp4" target="_blank" rel="noreferrer">Watch the full setup walkthrough (video)</a> — documents every step and fix from the original Meta app setup.</p>}
      {!isAdmin && <p className="secret-note">Connect with {setting.label} on the Accounts page — no setup needed.</p>}
    </div>
  </details>;
}

function TikTokPlatformCard({ isAdmin, tiktokConfigured }: { isAdmin: boolean; tiktokConfigured: boolean }) {
  const steps = [
    "Create a TikTok for Developers app with Login Kit and the video.upload + video.publish scopes.",
    "Add https://zepostia.com/oauth/tiktok/callback as a Redirect URI in the TikTok app.",
    "Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET on the server, then hit Connect on the Accounts page.",
  ];
  return <details className="settings-card" open>
    <summary><span><PlatformBadge platform="tiktok" /><strong>TikTok</strong></span><span>No setup needed</span><span className="summary-chev"><IconChevron /></span></summary>
    <div className="settings-body">
      {isAdmin && <div className="go-live-list">{steps.map((step, i) => <p key={i}><b>{i + 1}</b><span>{step}</span></p>)}</div>}
      <p className="secret-note">TikTok posts video only. New TikTok apps post privately until the app passes TikTok's audit. Connect with TikTok on the Accounts page — no setup needed.</p>
      {isAdmin && <p className="secret-note">Owner TikTok app: {tiktokConfigured ? "configured" : "not configured — set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET on the server"}.</p>}
    </div>
  </details>;
}

function XPlatformCard({ isAdmin, xConfigured }: { isAdmin: boolean; xConfigured: boolean }) {
  const steps = [
    "Create an X app in the X Developer Portal with OAuth 2.0 enabled.",
    "Add https://zepostia.com/oauth/x/callback as the Callback URI / Redirect URL in the app's OAuth 2.0 settings.",
    "Set X_CLIENT_ID and X_CLIENT_SECRET on the server, then hit Connect on the Accounts page.",
  ];
  return <details className="settings-card" open>
    <summary><span><PlatformBadge platform="x" /><strong>X</strong></span><span>No setup needed</span><span className="summary-chev"><IconChevron /></span></summary>
    <div className="settings-body">
      {isAdmin && <div className="go-live-list">{steps.map((step, i) => <p key={i}><b>{i + 1}</b><span>{step}</span></p>)}</div>}
      <p className="secret-note">X posts text only (280 characters max).</p>
      {isAdmin && <p className="secret-note">Owner X app: {xConfigured ? "configured" : "not configured — set X_CLIENT_ID and X_CLIENT_SECRET on the server"}.</p>}
      {isAdmin && <p className="secret-note">Heads up: X charges per tweet on new developer accounts (pay-per-use, roughly $0.015 per post, more for posts with links). Every customer tweet bills your X account — fund credits in the X Developer Console before real posting.</p>}
      {!isAdmin && <p className="secret-note">Connect with X on the Accounts page — no setup needed.</p>}
    </div>
  </details>;
}

function YoutubePlatformCard({ isAdmin, youtubeConfigured }: { isAdmin: boolean; youtubeConfigured: boolean }) {
  const steps = [
    "Create a Google Cloud project and enable the YouTube Data API v3.",
    "Create an OAuth 2.0 Client ID (Web application) and add https://zepostia.com/oauth/youtube/callback as an Authorized redirect URI.",
    "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET on the server, then hit Connect on the Accounts page and pick your channel.",
  ];
  return <details className="settings-card" open>
    <summary><span><PlatformBadge platform="youtube" /><strong>YouTube</strong></span><span>No setup needed</span><span className="summary-chev"><IconChevron /></span></summary>
    <div className="settings-body">
      {isAdmin && <div className="go-live-list">{steps.map((step, i) => <p key={i}><b>{i + 1}</b><span>{step}</span></p>)}</div>}
      <p className="secret-note">YouTube posts video only — every upload needs a video file and a title. Uploads use ~1,000 API quota units each (10,000/day free). Connect with YouTube on the Accounts page — no setup needed.</p>
      {isAdmin && <p className="secret-note">Owner YouTube app: {youtubeConfigured ? "configured" : "not configured — set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET on the server"}.</p>}
    </div>
  </details>;
}

function OwnerPlatformSettingsCard({ setting, token, onMessage, isAdmin, metaConfigured, tiktokConfigured, youtubeConfigured, xConfigured, xPostsUsed, xPostsCap, tiktokPostsUsed, tiktokPostsCap }: { setting: PlatformSetting; token: string; onMessage: (message: string) => void; isAdmin: boolean; metaConfigured: boolean; tiktokConfigured: boolean; youtubeConfigured: boolean; xConfigured: boolean; xPostsUsed: number; xPostsCap: number; tiktokPostsUsed: number; tiktokPostsCap: number }) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState(setting.clientId);
  const [clientSecret, setClientSecret] = useState("");
  useEffect(() => { setClientId(setting.clientId); }, [setting.clientId]);
  const save = useMutation({
    mutationFn: () => api.savePlatformConfig({ sessionToken: token, platform: setting.platform, clientId, secretReference: "", clientSecret }),
    onSuccess: async (result) => { onMessage(result.message); await queryClient.invalidateQueries({ queryKey: ["settings", token] }); },
  });
  if (setting.platform === "facebook" || setting.platform === "instagram") {
    return <MetaPlatformCard setting={setting} isAdmin={isAdmin} metaConfigured={metaConfigured} token={token} onMessage={onMessage} />;
  }
  if (setting.platform === "tiktok") {
    return <TikTokPlatformCard isAdmin={isAdmin} tiktokConfigured={tiktokConfigured} />;
  }
  if (setting.platform === "youtube") {
    return <YoutubePlatformCard isAdmin={isAdmin} youtubeConfigured={youtubeConfigured} />;
  }
  if (setting.platform === "x") {
    return <XPlatformCard isAdmin={isAdmin} xConfigured={xConfigured} />;
  }
  return <details className="settings-card" open>
    <summary><span><PlatformBadge platform={setting.platform} /><strong>{setting.label}</strong></span><span>Set up credentials</span><span className="summary-chev"><IconChevron /></span></summary>
    <div className="settings-body">
      <div className="go-live-list"><p><b>1</b><span>Create:</span> {setting.developerApp}</p><p><b>2</b><span>Collect:</span> {setting.credentialFields}</p><p><b>3</b><span>Callback:</span> Deploy the app on your host, then add the exact OAuth callback URL for that deployment (see DEPLOY.md).</p><p><b>4</b><span>Permissions:</span> Request only sign-in, profile/account discovery, and content publishing scopes.</p></div>
      <label>App ID (Client ID)<input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Paste your App ID" /></label>
      <label>App Secret<input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Paste your App Secret" /></label>
      <p className="secret-note">Your secret is encrypted before it is stored and never shown again.</p>
      <button className="secondary-button" disabled={save.isPending || !clientId.trim()} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save configuration"}</button>
    </div>
  </details>;
}

function BillingSection({ token, onMessage }: { token: string; onMessage: (message: string) => void }) {
  const queryClient = useQueryClient();
  // X add-on tier picked at checkout (null = base plan only). The tier
  // is charged on the Checkout page itself — it never joins the free
  // trial — and renews on its own subscription from month two.
  const [checkoutTier, setCheckoutTier] = useState<string | null>(null);
  const statusQuery = useQuery({
    queryKey: ["billing", token],
    queryFn: () => api.getBillingStatus({ sessionToken: token }),
    retry: false,
  });
  const friendly = (e: unknown) => {
    const msg = e instanceof Error ? e.message : "Could not continue.";
    return /not configured/i.test(msg) ? "Billing isn't connected yet. Check back soon." : msg.replace(/^action \w+ error: /, "");
  };
  const checkout = useMutation({
    mutationFn: () => api.createCheckoutSession({ sessionToken: token, ...(checkoutTier ? { xAddonTierPriceId: checkoutTier } : {}) }),
    onSuccess: (result) => { window.location.href = result.url; },
    onError: (e) => onMessage(friendly(e)),
  });
  const portal = useMutation({
    mutationFn: () => api.createPortalSession({ sessionToken: token }),
    onSuccess: (result) => { window.location.href = result.url; },
    onError: (e) => onMessage(friendly(e)),
  });
  const setTier = useMutation({
    mutationFn: (priceId: string) => api.setXAddonTier({ sessionToken: token, priceId }),
    onSuccess: async (result) => {
      onMessage(result.activeTier ? `X add-on: ${result.activeTier} is now active.` : "X add-on updated.");
      await queryClient.invalidateQueries({ queryKey: ["billing", token] });
    },
    onError: (e) => onMessage(friendly(e)),
  });
  const removeAddon = useMutation({
    mutationFn: () => api.removeXAddon({ sessionToken: token }),
    onSuccess: async () => {
      onMessage("X add-on removed.");
      await queryClient.invalidateQueries({ queryKey: ["billing", token] });
    },
    onError: (e) => onMessage(friendly(e)),
  });
  const xAddon = statusQuery.data?.xAddon;
  const status = statusQuery.data?.status ?? "none";
  const subscribed = ["trialing", "active", "past_due"].includes(status);
  const label = status === "trialing" ? "Free trial" : status === "active" ? "Active" : status === "past_due" ? "Past due" : status === "canceled" ? "Canceled" : "No subscription";
  const trialEnd = statusQuery.data?.trialEndsAt ? new Date(statusQuery.data.trialEndsAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
  const renews = status === "active" && statusQuery.data?.currentPeriodEnd ? new Date(statusQuery.data.currentPeriodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
  return <section className="billing-block" aria-label="Billing">
    <div className="billing-card">
      <div className="billing-card-icon" aria-hidden="true"><IconCard /></div>
      <div className="billing-card-main">
        <p className="billing-eyebrow">Current plan</p>
        <p className="billing-price">$19.88 / month <span className="billed-pill">Billed monthly</span> <small><a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> · <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy</a></small></p>
        {statusQuery.isPending ? <p className="billing-status">Loading…</p> : statusQuery.isError ? <p className="billing-status">Could not load billing status.</p> : <>
          <p className="billing-status"><strong>{label}</strong>{trialEnd ? ` · First charge ${trialEnd}` : null}{renews ? ` · Renews ${renews}` : null}</p>
          {!subscribed && xAddon?.configured && xAddon.tiers.length > 0 && <div className="x-checkout-picker">
            <p className="x-checkout-picker-title">Add X posting now? It bills from day one.</p>
            <ul className="x-tier-list x-picker-list">
              <li className={checkoutTier === null ? "selected" : undefined} onClick={() => setCheckoutTier(null)}>
                <label>
                  <input type="radio" name="x-checkout-tier" checked={checkoutTier === null} onChange={() => setCheckoutTier(null)} />
                  <span><strong>No X add-on</strong> — base plan only</span>
                </label>
              </li>
              {xAddon.tiers.map((tier) => <li key={tier.priceId} className={checkoutTier === tier.priceId ? "selected" : undefined} onClick={() => setCheckoutTier(tier.priceId)}>
                <label>
                  <input type="radio" name="x-checkout-tier" checked={checkoutTier === tier.priceId} onChange={() => setCheckoutTier(tier.priceId)} />
                  <span><strong>{tier.name}</strong> — {tier.postsPerMonth} posts · {tier.linkPostsPerMonth} link posts / month</span>
                </label>
              </li>)}
            </ul>
          </div>}
          {subscribed
            ? <div className="billing-actions">
                <button className="primary-button" disabled={portal.isPending} onClick={() => portal.mutate()}>{portal.isPending ? "Working…" : "Manage billing"}</button>
                <button className="secondary-button" disabled={portal.isPending} onClick={() => portal.mutate()}>View invoices</button>
              </div>
            : <button className="primary-button" disabled={checkout.isPending} onClick={() => checkout.mutate()}>{checkout.isPending ? "Working…" : "Start subscription"}</button>}
          {!subscribed && <p className="billing-trial">14-day free trial — your card is charged $19.88 on day 15. Cancel anytime.</p>}
        </>}
      </div>
      <ul className="billing-perks">
        <li><span className="trust-check"><IconCheck /></span>Post to every connected platform</li>
        <li><span className="trust-check"><IconCheck /></span>Scheduling and post history</li>
        <li><span className="trust-check"><IconCheck /></span>Cancel anytime</li>
        <li><span className="trust-check"><IconCheck /></span>Access to all features</li>
      </ul>
    </div>
    {!statusQuery.isPending && !statusQuery.isError && xAddon?.configured && <div className="x-addon-card">
      <div className="billing-card-icon" aria-hidden="true"><IconBolt /></div>
      <div className="x-addon-main">
        <h3>X (Twitter) posting — Add-on</h3>
        {xAddon.activeTier
          ? <p><strong>{xAddon.activeTier}</strong> · {xAddon.usage.postsUsed} of {xAddon.usage.postsCap} posts · {xAddon.usage.linkPostsUsed} of {xAddon.usage.linkPostsCap} link posts this billing period</p>
          : <p>Not added</p>}
        {subscribed && !xAddon.activeTier && <p className="x-addon-line">Posting to X is a paid add-on. Pick a tier to turn it on.</p>}
        {subscribed ? <>
          <ul className="x-tier-list">{xAddon.tiers.map((tier) => {
            const current = tier.name === xAddon.activeTier;
            return <li key={tier.priceId}>
              <span><strong>{tier.name}</strong> — {tier.postsPerMonth} posts · {tier.linkPostsPerMonth} link posts / month</span>
              {tier.amountCents != null && <span className="x-tier-price">${(tier.amountCents / 100).toFixed(2).replace(/\.00$/, "")} / month</span>}
              {current
                ? <span className="status-pill status-live"><i />Current tier</span>
                : <button className="secondary-button" disabled={setTier.isPending || removeAddon.isPending} onClick={() => setTier.mutate(tier.priceId)}>{setTier.isPending ? "Working…" : xAddon.activeTier ? `Switch to ${tier.name}` : `Add ${tier.name}`}</button>}
            </li>;
          })}</ul>
          {xAddon.activeTier && <button className="quiet-button" disabled={removeAddon.isPending || setTier.isPending} onClick={() => removeAddon.mutate()}>{removeAddon.isPending ? "Working…" : "Remove add-on"}</button>}
        </> : <p className="x-addon-line">You can pick a tier when you subscribe — or add one any time after.</p>}
      </div>
    </div>}
    <BillingHistoryCard token={token} subscribed={subscribed} onViewAll={() => portal.mutate()} viewAllPending={portal.isPending} />
    <p className="billing-support">Questions about billing? Contact our <a href="mailto:zepostia@cryptobagtracker.io">support team</a>.</p>
  </section>;
}

function BillingHistoryCard({ token, subscribed, onViewAll, viewAllPending }: { token: string; subscribed: boolean; onViewAll: () => void; viewAllPending: boolean }) {
  const invoicesQuery = useQuery({
    queryKey: ["billing-invoices", token],
    queryFn: () => api.listBillingInvoices({ sessionToken: token }),
    retry: false,
  });
  const invoices = invoicesQuery.data?.invoices ?? [];
  const formatAmount = (cents: number, currency: string) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
    } catch {
      return `$${(cents / 100).toFixed(2)}`;
    }
  };
  return <div className="billing-history-card">
    <div className="settings-section-head">
      <span className="settings-section-icon tint-slate"><IconDoc /></span>
      <div className="settings-section-titles"><h3>Billing history</h3><p>View your past invoices and payments.</p></div>
      {(subscribed || invoices.length > 0) && <button className="secondary-button billing-history-all" disabled={viewAllPending} onClick={onViewAll}><IconExternal /> View all invoices</button>}
    </div>
    {invoicesQuery.isPending ? <p className="billing-status">Loading…</p> : invoices.length === 0 ? <p className="billing-history-empty">No invoices yet.</p> : <table className="invoice-table">
      <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th><th>Invoice</th></tr></thead>
      <tbody>{invoices.map((invoice) => <tr key={invoice.id}>
        <td data-label="Date">{new Date(invoice.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
        <td data-label="Description">{invoice.description}</td>
        <td data-label="Amount">{formatAmount(invoice.amountCents, invoice.currency)}</td>
        <td data-label="Status"><span className={`invoice-status invoice-status-${invoice.status.toLowerCase()}`}><i />{invoice.status}</span></td>
        <td data-label="Invoice">{invoice.hostedInvoiceUrl ? <a className="invoice-link" href={invoice.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer"><IconExternal /> View invoice</a> : <span className="dim-text">—</span>}</td>
      </tr>)}</tbody>
    </table>}
  </div>;
}

function BillingPage({ token, onMessage, go }: { token: string; onMessage: (message: string) => void; go: (page: Page) => void }) {
  return <div className="page-stack billing-page">
    <div className="page-heading settings-heading">
      <div><h1>Billing</h1><p>Manage your plan, add-ons, and payment details.</p></div>
      <button className="billing-help-button" onClick={() => go("help")}><IconHelp /> Billing help</button>
    </div>
    <BillingSection token={token} onMessage={onMessage} />
  </div>;
}

function PasswordField({ label, placeholder, value, onChange, autoComplete }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return <label className="password-field">{label}
    <span className="password-input">
      <input type={show ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} required />
      <button type="button" className="password-eye" aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} onClick={() => setShow((current) => !current)}>{show ? <IconEyeOff /> : <IconEye />}</button>
    </span>
  </label>;
}

function ChangePasswordForm({ token, onMessage }: { token: string; onMessage: (message: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const change = useMutation({ mutationFn: (payload: { sessionToken: string; currentPassword: string; newPassword: string }) => api.changePassword(payload) });
  const run = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    if (next.length < 8) { setMessage("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setMessage("New passwords don't match."); return; }
    try {
      const result = await change.mutateAsync({ sessionToken: token, currentPassword: current, newPassword: next });
      setMessage(result.message);
      if (result.ok) { setCurrent(""); setNext(""); setConfirm(""); onMessage(result.message); }
    } catch (e) {
      setMessage(e instanceof Error ? e.message.replace(/^action \w+ error: /, "") : "Could not continue.");
    }
  };
  return <form onSubmit={run} className="change-password-form">
    <div className="password-grid">
      <PasswordField label="Current password" placeholder="Enter current password" value={current} onChange={setCurrent} autoComplete="current-password" />
      <PasswordField label="New password" placeholder="Enter new password" value={next} onChange={setNext} autoComplete="new-password" />
      <PasswordField label="Confirm new password" placeholder="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
    </div>
    {message && <p className="form-message" role="status">{message}</p>}
    <button className="primary-button password-submit" type="submit" disabled={change.isPending}>{change.isPending ? "Updating…" : "Update password"}</button>
  </form>;
}

function AdminResetTool({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const generate = useMutation({ mutationFn: (payload: { sessionToken: string; email: string }) => api.generatePasswordResetLink(payload) });
  const run = async () => {
    setMessage(""); setLink("");
    const result = await generate.mutateAsync({ sessionToken: token, email });
    setMessage(result.message);
    if (result.ok && result.resetUrl) setLink(result.resetUrl);
  };
  return <section className="settings-card admin-reset">
    <h2>Password reset (admin)</h2>
    <p className="secret-note">Generate a one-time reset link for any account. The link expires in 1 hour and works once.</p>
    <div className="admin-reset-row">
      <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="user@example.com" aria-label="Account email" />
      <button className="secondary-button" disabled={generate.isPending || !email.trim()} onClick={run}>{generate.isPending ? "Generating…" : "Generate link"}</button>
    </div>
    {message && <p className="form-message" role="status">{message}</p>}
    {link && <p className="reset-link"><code>{link}</code></p>}
  </section>;
}

function Settings({ settings, token, user, metaConfigured, tiktokConfigured, youtubeConfigured, xConfigured, xPostsUsed, xPostsCap, tiktokPostsUsed, tiktokPostsCap, xVisible, onMessage, onSignOut, go }: { settings: PlatformSetting[]; token: string; user: { email: string; displayName: string; role: string }; metaConfigured: boolean; tiktokConfigured: boolean; youtubeConfigured: boolean; xConfigured: boolean; xPostsUsed: number; xPostsCap: number; tiktokPostsUsed: number; tiktokPostsCap: number; xVisible: boolean; onMessage: (message: string) => void; onSignOut: () => void; go: (page: Page) => void }) {
  const isAdmin = user.role === "admin";
  const [showCredentials, setShowCredentials] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const deleteAccount = useMutation({
    mutationFn: () => api.deleteAccount({ sessionToken: token, confirmation: deleteText }),
    onSuccess: (result) => {
      if (result.ok) { onSignOut(); return; }
      setDeleteMessage(result.message);
    },
    onError: (e) => setDeleteMessage(e instanceof Error ? e.message.replace(/^action \w+ error: /, "") : "Could not continue."),
  });
  const miniPlatforms: Platform[] = (["facebook", "instagram", "tiktok", "youtube", "x"] as Platform[]).filter((platform) => platform !== "x" || xVisible);
  return <div className="page-stack">
    <div className="page-heading settings-heading">
      <div><h1>Settings</h1><p>Manage your account, platform connections, and preferences.</p></div>
      <button className="secondary-button" onClick={() => go("billing")}>View billing</button>
    </div>

    <section className="settings-section-card">
      <div className="settings-section-head">
        <span className="settings-section-icon tint-accent"><IconLink /></span>
        <div className="settings-section-titles"><h2>Platform connections</h2><p>Connect your social accounts to start posting.</p></div>
        <button className="text-link-button settings-credentials-link" onClick={() => setShowCredentials(true)}>How credentials work <IconArrowRight /></button>
      </div>
      <div className="platform-mini-grid">
        {miniPlatforms.map((platform) => <button key={platform} type="button" className="platform-mini" onClick={() => go("accounts")}>
          <PlatformBadge platform={platform} large />
          <span className="platform-mini-name">{PLATFORM_META[platform].label}</span>
          <span className="platform-mini-note">No setup needed</span>
          <span className="platform-mini-chev"><IconChevron /></span>
        </button>)}
      </div>
    </section>

    <section className="settings-section-card">
      <div className="settings-section-head">
        <span className="settings-section-icon tint-slate"><IconUser /></span>
        <div className="settings-section-titles"><h2>Profile</h2><p>Manage your account details and sign out.</p></div>
      </div>
      <div className="profile-row">
        <span className="profile-avatar" aria-hidden="true">{user.displayName.trim().charAt(0).toUpperCase() || "Z"}</span>
        <div className="profile-id"><strong>{user.displayName}</strong><span>{user.email}</span></div>
        <button className="secondary-button" onClick={onSignOut}><IconLogout /> Sign out</button>
      </div>
    </section>

    <section className="settings-section-card">
      <div className="settings-section-head">
        <span className="settings-section-icon tint-green"><IconLock /></span>
        <div className="settings-section-titles"><h2>Change password</h2><p>Keep your account secure with a strong password.</p></div>
      </div>
      <ChangePasswordForm token={token} onMessage={onMessage} />
    </section>

    <section className="settings-section-card">
      <div className="settings-section-head">
        <span className="settings-section-icon tint-red"><IconTrash /></span>
        <div className="settings-section-titles"><h2>Account actions</h2><p>Permanently delete your account and all data.</p></div>
      </div>
      <div className="delete-row">
        <div className="delete-copy">
          <strong className="delete-title">Delete account</strong>
          <p>This will permanently remove your account, posts, and all connected platforms. This action cannot be undone.</p>
        </div>
        <button className="danger-outline-button" onClick={() => { setDeleteText(""); setDeleteMessage(""); setShowDelete(true); }}>Delete account</button>
      </div>
    </section>

    {isAdmin && <section className="owner-setup">
      <div className="page-heading"><h2>Owner setup</h2><p>Admin only — platform app credentials and setup steps. Customers never see this section.</p></div>
      <section className="settings-list">{settings.filter((setting) => setting.platform !== "x" || xVisible).map((setting) => <OwnerPlatformSettingsCard key={setting.platform} setting={setting} token={token} onMessage={onMessage} isAdmin={isAdmin} metaConfigured={metaConfigured} tiktokConfigured={tiktokConfigured} youtubeConfigured={youtubeConfigured} xConfigured={xConfigured} xPostsUsed={xPostsUsed} xPostsCap={xPostsCap} tiktokPostsUsed={tiktokPostsUsed} tiktokPostsCap={tiktokPostsCap} />)}</section>
      <AdminResetTool token={token} />
    </section>}

    {showCredentials && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="How credentials work" onClick={() => setShowCredentials(false)}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={() => setShowCredentials(false)}><IconClose /></button>
        <span className="manifest-icon"><IconGear /></span>
        <h2>How credentials work</h2>
        <p>When you connect a platform, zepostia stores an access token — never your password. Tokens are encrypted and only used to publish the posts you create.</p>
        <button className="primary-button" onClick={() => setShowCredentials(false)}>Got it</button>
      </div>
    </div>}

    {showDelete && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Delete account" onClick={() => setShowDelete(false)}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={() => setShowDelete(false)}><IconClose /></button>
        <span className="settings-section-icon tint-red"><IconTrash /></span>
        <h2>Delete your account?</h2>
        <p>This permanently removes your account, posts, and all connected platforms, and cancels any active subscription. This action cannot be undone.</p>
        <label className="field-label">Type DELETE or your email to confirm
          <input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder="DELETE" autoComplete="off" />
        </label>
        {deleteMessage && <p className="form-message" role="status">{deleteMessage}</p>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={() => setShowDelete(false)}>Keep my account</button>
          <button className="danger-button" disabled={deleteAccount.isPending || (deleteText.trim() !== "DELETE" && deleteText.trim().toLowerCase() !== user.email.toLowerCase())} onClick={() => deleteAccount.mutate()}>{deleteAccount.isPending ? "Deleting…" : "Delete account"}</button>
        </div>
      </div>
    </div>}
  </div>;
}



type HelpCardDef = { id: string; title: string; sub?: string; search: string; defaultOpen?: boolean; body: ReactNode };

function HelpPage({ go, xVisible }: { go: (page: Page) => void; xVisible: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [query, setQuery] = useState("");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const isOpen = (card: HelpCardDef) => openMap[card.id] ?? Boolean(card.defaultOpen);
  const toggleCard = (card: HelpCardDef) => setOpenMap((current) => ({ ...current, [card.id]: !isOpen(card) }));
  const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const openSectionCards = (ids: string[]) => setOpenMap((current) => { const next = { ...current }; ids.forEach((id) => { next[id] = true; }); return next; });

  const platformCards: HelpCardDef[] = [
    {
      id: "connect-facebook", title: "Facebook", sub: "Post to your Pages", defaultOpen: true,
      search: "facebook connect pages post login approve account connection",
      body: <>
        <ol>
          <li>On the Accounts page, hit <strong>Connect</strong> next to Facebook.</li>
          <li>Facebook opens its login page — log in and approve zepostia.</li>
          <li>Choose which of your Facebook <strong>Pages</strong> zepostia can post to.</li>
        </ol>
        <p className="help-note">Zepostia posts to Pages you manage, not personal profiles. You&apos;re granting permission to publish posts on your behalf — you can revoke it any time in your Facebook settings.</p>
      </>,
    },
    {
      id: "connect-instagram", title: "Instagram", sub: "Requires a professional account",
      search: "instagram connect professional account creator business facebook page link account connection",
      body: <>
        <p>Instagram only allows third-party posting for <strong>professional accounts</strong> (creator or business). Before connecting:</p>
        <ol>
          <li>In the Instagram app, switch your account to professional: Settings → Account type and tools → Switch to professional account.</li>
          <li>Link it to one of your Facebook Pages: in the Instagram app, go to Settings → Account → Sharing to other apps, or link it from your Facebook Page&apos;s settings.</li>
          <li>Back on the Accounts page, hit <strong>Connect</strong> next to Instagram and approve zepostia.</li>
        </ol>
        <p className="help-note">Personal Instagram accounts can&apos;t be connected — this is Instagram&apos;s rule, not ours.</p>
      </>,
    },
    {
      id: "connect-tiktok", title: "TikTok", sub: "Video posts",
      search: "tiktok connect video private audit account connection",
      body: <>
        <ol>
          <li>On the Accounts page, hit <strong>Connect</strong> next to TikTok.</li>
          <li>TikTok opens its login page — log in and authorize zepostia to upload videos.</li>
        </ol>
        <p className="help-note">TikTok posts are video only. New apps publish privately until TikTok approves them — if your video lands as private, that&apos;s why.</p>
      </>,
    },
    {
      id: "connect-youtube", title: "YouTube", sub: "Video uploads to your channel",
      search: "youtube connect google channel upload video account connection",
      body: <>
        <ol>
          <li>On the Accounts page, hit <strong>Connect</strong> next to YouTube.</li>
          <li>Google opens its sign-in page — sign in and grant zepostia permission to upload videos.</li>
          <li>Pick the channel you want zepostia to upload to.</li>
        </ol>
        <p className="help-note">Every upload needs a video file and a title. You&apos;re granting the YouTube upload permission only — zepostia can&apos;t read your email or access anything else in your Google account.</p>
      </>,
    },
    ...(xVisible ? [{
      id: "connect-x", title: "X", sub: "Text posts, 280 characters",
      search: "x twitter connect add-on tier account connection",
      body: <>
        <ol>
          <li>On the Accounts page, hit <strong>Connect</strong> next to X.</li>
          <li>X opens its authorization page — log in and approve zepostia.</li>
        </ol>
        <p className="help-note">X posting is an <strong>add-on</strong>: your tier sets how many X posts — and how many posts with links — you can publish each billing period. You can see your tier and usage on the Billing page.</p>
      </>,
    } as HelpCardDef] : []),
  ];

  const troubleCards: HelpCardDef[] = [
    {
      id: "trouble-expired", title: "My connection expired", sub: "Reconnect in one click",
      search: "connection expired reconnect password change revoked account connection",
      body: <p>Platforms occasionally revoke access (usually after a password change or a long idle period). On the Accounts page, the account will show a warning — hit <strong>Reconnect</strong> and approve zepostia again. Your scheduled posts will resume.</p>,
    },
    {
      id: "trouble-failed", title: "A post failed", sub: "Check the reason",
      search: "post failed reason media type too long error creating a post publish",
      body: <>
        <p>Open the Post page and look at your queued and past posts — failed posts show the reason. Common causes:</p>
        <ul>
          <li>The account&apos;s connection expired — reconnect it on the Accounts page.</li>
          <li>The media type isn&apos;t supported (e.g. text-only to TikTok, which needs video).</li>
          <li>The text is too long for the platform (X&apos;s 280-character limit).</li>
        </ul>
        <p>Fix the issue and repost.</p>
      </>,
    },
    {
      id: "trouble-instagram", title: "Instagram won't connect", sub: "Check the requirements",
      search: "instagram won't connect professional account facebook page requirements account connection",
      body: <p>Instagram requires a <strong>professional account</strong> linked to a <strong>Facebook Page</strong>. If either is missing, the connection fails. Switch to professional in the Instagram app, link a Page, then try connecting again.</p>,
    },
    {
      id: "trouble-scheduled", title: "A scheduled post didn't go out", sub: "Check the queue",
      search: "scheduled post didn't go out queue pending scheduling",
      body: <p>Check the Post page — if the post shows as failed, the reason is listed there. If it&apos;s still pending past its scheduled time, make sure the account is still connected on the Accounts page.</p>,
    },
  ];

  const faqCards: Array<HelpCardDef & { Icon: ComponentType }> = [
    {
      id: "faq-developer", title: "Do I need a developer account with any platform?", Icon: IconGear,
      search: "developer account platform setup technical",
      body: <p>No. You just click Connect and log in with the platform. All the technical setup is handled by zepostia.</p>,
    },
    {
      id: "faq-passwords", title: "Does zepostia see or store my passwords?", Icon: IconShield,
      search: "passwords see store security login token",
      body: <p>No. You log in on each platform&apos;s own website (facebook.com, google.com, x.com, tiktok.com) — zepostia never sees your password. The platforms give zepostia a limited access token that only allows posting.</p>,
    },
    {
      id: "faq-disconnect", title: "Can I disconnect an account?", Icon: IconLink,
      search: "disconnect account remove revoke access",
      body: <p>Yes, any time. On the Accounts page, hit <strong>Disconnect</strong> next to the account. You can also revoke zepostia&apos;s access directly in each platform&apos;s settings.</p>,
    },
    {
      id: "faq-limits", title: "What counts toward my monthly limits?", Icon: IconHistory,
      search: "monthly limits usage count billing plan tier posts link posts reset",
      body: <p>Only <strong>successful</strong> posts count. Failed posts don&apos;t use your quota. TikTok includes 60 posts per month; the count resets on the 1st. X posting is an add-on — its post and link-post limits follow your tier and reset each billing period. You can see your current usage on the Billing page.</p>,
    },
    {
      id: "faq-some", title: "Can I post to some platforms but not others?", Icon: IconCompose,
      search: "post some platforms choose accounts per post",
      body: <p>Yes. Every post lets you choose exactly which connected accounts it goes to. Connect everything once, then pick per post.</p>,
    },
  ];
  const allFaqOpen = faqCards.every((card) => isOpen(card));
  const toggleAllFaq = () => setOpenMap((current) => { const next = { ...current }; faqCards.forEach((card) => { next[card.id] = !allFaqOpen; }); return next; });

  const categories: Array<{ Icon: ComponentType; tint: string; title: string; line: string; target: string; openIds: string[] }> = [
    { Icon: IconUsers, tint: "tint-accent", title: "Account connection", line: "Learn how to connect and manage your social accounts.", target: "help-connecting", openIds: ["connect-facebook"] },
    { Icon: IconCompose, tint: "tint-slate", title: "Creating a post", line: "Write, add media, and publish to multiple platforms.", target: "help-posting", openIds: [] },
    { Icon: IconClock, tint: "tint-warm", title: "Scheduling", line: "Set up scheduled posts and manage your queue.", target: "help-troubleshooting", openIds: ["trouble-scheduled"] },
    { Icon: IconHistory, tint: "tint-green", title: "Billing & limits", line: "Understand your plan, usage limits, and billing.", target: "help-faq", openIds: ["faq-limits"] },
  ];

  const renderCard = (card: HelpCardDef) => matches(`${card.title} ${card.sub ?? ""} ${card.search}`) ? (
    <details className="help-card" key={card.id} open={isOpen(card)} onToggle={(event) => { const open = (event.currentTarget as HTMLDetailsElement).open; setOpenMap((current) => (current[card.id] === open ? current : { ...current, [card.id]: open })); }}>
      <summary><strong>{card.title}</strong>{card.sub && <span>{card.sub}</span>}<span className="summary-chev"><IconChevron /></span></summary>
      {card.body}
    </details>
  ) : null;
  const sectionVisible = (cards: HelpCardDef[]) => !q || cards.some((card) => matches(`${card.title} ${card.sub ?? ""} ${card.search}`));

  return <div className="page-stack">
    <div className="page-heading"><h1>Help</h1><p>Everything you need to connect your accounts and start posting. No technical setup required — you just click Connect and log in with each platform.</p></div>

    <section className="tour-card">
      <div className="tour-left">
        <span className="tour-eyebrow"><span className="tour-eyebrow-icon"><IconPlaySolid /></span>GET STARTED</span>
        <h2>Watch the tour</h2>
        <p>A one-minute walkthrough: connect your accounts, write a post, and publish.</p>
        <button className="primary-button" onClick={() => { videoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); void videoRef.current?.play().catch(() => undefined); }}><span className="btn-play"><IconPlaySolid /></span>Play video (1:11)</button>
      </div>
      <video ref={videoRef} className="help-video" controls preload="none" poster="/getting-started-poster.png" src="/getting-started-tutorial.mp4" />
    </section>

    <section className="help-plain">
      <div className="help-section-head">
        <div><h2>Common issues</h2><p>Get quick solutions to the most common questions.</p></div>
        <label className="help-search"><span className="help-search-icon"><IconSearch /></span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for help articles…" aria-label="Search for help articles" /></label>
      </div>
      <div className="issue-grid">
        {categories.map((category) => (
          <button className="issue-card" key={category.title} onClick={() => { openSectionCards(category.openIds); scrollToId(category.target); }}>
            <span className={`issue-icon ${category.tint}`}><category.Icon /></span>
            <span className="issue-text"><strong>{category.title}</strong><span>{category.line}</span></span>
            <span className="issue-arrow"><IconArrowRight /></span>
          </button>
        ))}
      </div>
    </section>

    {matches("getting started create your account connect your accounts write your first post sign up plan") && <section className="help-section">
      <h2>Getting started</h2>
      <div className="help-steps">
        <div className="help-step"><span>1</span><div><strong>Create your account</strong><p>Sign up for zepostia and pick the $19.88/month plan. Your first 14 days are free.</p></div></div>
        <div className="help-step"><span>2</span><div><strong>Connect your accounts</strong><p>Go to the <button className="text-button" onClick={() => go("accounts")}>Accounts page</button> and hit <strong>Connect</strong> next to each platform. You&apos;ll be taken to that platform&apos;s own login page — log in and approve zepostia. That&apos;s the whole setup.</p></div></div>
        <div className="help-step"><span>3</span><div><strong>Write your first post</strong><p>Open the <button className="text-button" onClick={() => go("post")}>Post page</button>, write your message, pick which connected accounts to publish to, and hit <strong>Post now</strong> — or pick a date and time to schedule it.</p></div></div>
      </div>
    </section>}

    {sectionVisible(platformCards) && <section className="help-section" id="help-connecting">
      <h2>Connecting each platform</h2>
      <div className="help-cards">
        {platformCards.map((card) => renderCard(card))}
      </div>
    </section>}

    {matches("posting write message post now schedule queue queued past posts creating a post publish") && <section className="help-section" id="help-posting">
      <h2>Posting</h2>
      <div className="help-article">
        <p>Write your message once on the <button className="text-button" onClick={() => go("post")}>Post page</button>, then choose which of your connected accounts it goes to. Each platform gets a version that fits its rules.</p>
        <ul>
          <li><strong>Post now</strong> publishes immediately to every selected account.</li>
          <li><strong>Schedule</strong> picks a date and time. Scheduled posts wait in your queue — you can cancel any of them before they go out.</li>
          <li><strong>Queued and past posts</strong> on the Post page shows everything: what&apos;s waiting, what published, and what failed (with the reason).</li>
        </ul>
      </div>
    </section>}

    {matches("platform supports text limit media notes facebook instagram tiktok youtube") && <section className="help-section">
      <h2>What each platform supports</h2>
      <div className="help-table-wrap"><table className="help-table">
        <thead><tr><th>Platform</th><th>Text limit</th><th>Media</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td><strong>Facebook</strong></td><td>No practical limit</td><td>Text, link, image</td><td>Posts to Pages you manage</td></tr>
          <tr><td><strong>Instagram</strong></td><td>2,200 characters</td><td>Image or video</td><td>Professional account required</td></tr>
          <tr><td><strong>TikTok</strong></td><td>Caption up to 2,200</td><td>Video only</td><td>60 posts/month included</td></tr>
          <tr><td><strong>YouTube</strong></td><td>Title + description</td><td>Video only</td><td>Uploads to your channel</td></tr>
          {xVisible && <tr><td><strong>X</strong></td><td>280 characters</td><td>Text (links supported)</td><td>Add-on — tier limits apply</td></tr>}
        </tbody>
      </table></div>
    </section>}

    {sectionVisible(troubleCards) && <section className="help-section" id="help-troubleshooting">
      <h2>Troubleshooting</h2>
      <div className="help-cards">
        {troubleCards.map((card) => renderCard(card))}
      </div>
    </section>}

    {sectionVisible(faqCards) && <section className="help-plain" id="help-faq">
      <div className="help-section-head">
        <div><h2>Frequently asked questions</h2><p>Find answers to common questions about zepostia.</p></div>
        <button className="text-button expand-all" onClick={toggleAllFaq}>{allFaqOpen ? "Collapse all −" : "Expand all +"}</button>
      </div>
      <div className="faq-grid">
        {faqCards.map((card) => matches(`${card.title} ${card.search}`) ? (
          <details className="help-card faq-card" key={card.id} open={isOpen(card)} onToggle={(event) => { const open = (event.currentTarget as HTMLDetailsElement).open; setOpenMap((current) => (current[card.id] === open ? current : { ...current, [card.id]: open })); }}>
            <summary><span className="faq-icon"><card.Icon /></span><strong>{card.title}</strong><span className="summary-chev"><IconChevron /></span></summary>
            {card.body}
          </details>
        ) : null)}
      </div>
    </section>}

    {q && !sectionVisible(platformCards) && !sectionVisible(troubleCards) && !sectionVisible(faqCards) && <p className="help-noresults">No help articles match &ldquo;{query}&rdquo;. Try a shorter search — or contact support below.</p>}

    <div className="help-bottom-row">
      <section className="help-mini-card">
        <span className="mini-card-icon"><IconBook /></span>
        <div><h3>Legal</h3><p>Read our terms of service and privacy policy.</p><p className="mini-links"><a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a><a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a></p></div>
      </section>
      <section className="help-mini-card">
        <span className="mini-card-icon"><IconComment /></span>
        <div><h3>Still need help?</h3><p>Can&apos;t find what you&apos;re looking for? Contact our support team.</p></div>
      </section>
      <a className="primary-button contact-support-btn" href="mailto:zepostia@cryptobagtracker.io"><span className="btn-mail"><IconMail /></span>Contact support</a>
    </div>
  </div>;
}

/**
 * Public /services page — the "what exactly do I get" explainer for
 * logged-out visitors, in the Accounts page pattern: every platform and
 * feature is a full card with a drawn icon tile on the left, a bold name
 * and one-line description, a status pill, and any action pinned right.
 * Only capabilities that are live today are stated.
 */
function ServicesPage() {
  const platformRows: Array<{ platform: Platform; blurb: string; note?: string; pill: string; pillClass: string; action?: { label: string; href: string } }> = [
    {
      platform: "facebook",
      blurb: "Post text, images, and videos to the Facebook Pages you manage.",
      pill: "Included in plan",
      pillClass: "status-good",
    },
    {
      platform: "instagram",
      blurb: "Publish photos, videos, and Reels to your professional account.",
      note: "Instagram requires a professional (creator or business) account linked to a Facebook Page — that's Instagram's rule, and the Help page walks you through it.",
      pill: "Included in plan",
      pillClass: "status-good",
    },
    {
      platform: "tiktok",
      blurb: "Post videos straight from the composer — no separate upload in the TikTok app.",
      note: "TikTok makes new apps post privately until the app passes TikTok's audit. The zepostia app is in review, so for now TikTok posts start out private; everything else about posting works as normal.",
      pill: "Included · video only",
      pillClass: "status-good",
    },
    {
      platform: "youtube",
      blurb: "Upload videos to your channel, with the title and description written here.",
      note: "YouTube posts are video only — every upload needs a video file and a title.",
      pill: "Included · video only",
      pillClass: "status-good",
    },
    {
      platform: "x",
      blurb: "Post to X from the same composer — text and links, up to 280 characters.",
      note: "X posting is a paid add-on, not part of the base plan. Pick a tier at checkout, or add one later from the Billing page.",
      pill: "Paid add-on",
      pillClass: "status-accent",
      action: { label: "See the tiers", href: "#pricing" },
    },
  ];
  const featureCards: Array<{ Icon: ComponentType; title: string; body: ReactNode }> = [
    {
      Icon: IconCompose,
      title: "One composer",
      body: "Write your post once, attach an image or video, and preview how it lands on each platform before it goes out. Zepostia fits the same post to each platform's rules — like X's 280 characters — so nothing is rejected for format.",
    },
    {
      Icon: IconClock,
      title: "Scheduling",
      body: "Publish right away, or pick a date and time. Scheduled posts wait in your queue, and you can cancel any of them before they go out.",
    },
    {
      Icon: IconHistory,
      title: "Queue & history",
      body: "Every post is tracked in one list: what's waiting, what published, and what failed — with the reason — for each platform it was sent to. No more checking five apps to see what actually went out.",
    },
    {
      Icon: IconPlay,
      title: "One-minute tour",
      body: "The Help page opens with a one-minute video walkthrough: connect your accounts, write a post, and publish. It's the whole product, start to finish.",
    },
    {
      Icon: IconShield,
      title: "Your passwords stay yours",
      body: "You sign in on each platform's own website and approve zepostia there. Zepostia stores an encrypted access token — never your password — and uses it only to publish the posts you create.",
    },
    {
      Icon: IconHelp,
      title: "Real support",
      body: <>The Help page covers setup, troubleshooting, and FAQs. Still stuck? Email support at <a href="mailto:zepostia@cryptobagtracker.io">zepostia@cryptobagtracker.io</a> and we&apos;ll get back to you.</>,
    },
  ];
  const faqs: Array<{ q: string; a: ReactNode }> = [
    {
      q: "What's included in the $19.88/month plan?",
      a: "Posting to Facebook Pages, Instagram professional accounts, TikTok, and YouTube; the composer with per-platform previews; scheduling; and your full post queue and history. X posting is the only extra — it's a paid add-on, in the tiers above.",
    },
    {
      q: "How does the X add-on work?",
      a: "X charges for API access per post, so X posting runs on its own tier with monthly caps. Plain posts and posts containing links are counted separately — a link post costs X more, so it has its own allowance. When you reach your cap, posting to X pauses until the next billing period; you are never charged per post beyond the tier price. Pick a tier at checkout, or add, switch, or remove one later on the Billing page. Tiers bill from day one — they don't join the base plan's free trial.",
    },
    {
      q: "Why did my TikTok video post privately?",
      a: "TikTok makes new apps post privately until the app passes TikTok's audit. Zepostia's TikTok app is currently in review, so videos posted through zepostia land as private for now. Once the audit completes, TikTok posts publish the normal way — nothing about your account or your videos changes.",
    },
    {
      q: "How does the 14-day free trial work?",
      a: "You get the full plan for 14 days. Your card is charged $19.88 on day 15, then monthly after that. Cancel any time before day 15 and you pay nothing for the plan. If you add an X tier, the tier bills from day one — X usage costs real money from the first post, so tiers are never part of the free trial.",
    },
    {
      q: "Do you need my social media passwords?",
      a: "No. You log in on each platform's own website — facebook.com, google.com, tiktok.com, x.com — and approve zepostia there. Zepostia receives a limited access token that only allows posting; it never sees or stores your password, and you can disconnect any account at any time.",
    },
  ];
  return (
    <div className="landing-shell">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <header className="landing-header">
        <div className="landing-brand"><a href="/" className="brand-home"><BrandMark className="brand-mark" /><strong>zepostia</strong></a></div>
        <nav className="landing-nav" aria-label="Primary">
          <a href="/services" aria-current="page">Services</a>
          <a href="/#how-it-works">Product</a>
          <a href="/#pricing">Pricing</a>
        </nav>
        <div className="landing-actions">
          <a className="quiet-button" href="/?auth=login">Log in</a>
          <a className="primary-button" href="/?auth=signup">Get Started</a>
        </div>
      </header>
      <main className="landing-main services-main">
        <section className="svc-hero">
          <span className="hero-badge">Services</span>
          <h1>What zepostia does for you.</h1>
          <p>Zepostia is a posting workspace for your social accounts: connect them once, then write a post a single time and publish it to all of them — right now, or scheduled for later.</p>
          <div className="hero-ctas">
            <a className="primary-button hero-cta" href="/?auth=signup">Get Started</a>
            <a className="secondary-button hero-cta" href="#pricing">See pricing</a>
          </div>
        </section>

        <section className="svc-section" aria-label="Platforms">
          <div className="svc-heading"><h2>Post where your audience already is</h2><p>Four platforms are in the plan. X joins them as an add-on. Every connection uses the platform&apos;s own login.</p></div>
          <div className="connect-list">
            {platformRows.map((row) => (
              <article className="connect-row" key={row.platform}>
                <div className="connect-main">
                  <PlatformBadge platform={row.platform} />
                  <div>
                    <h2>{PLATFORM_META[row.platform].label}</h2>
                    <p>{row.blurb}</p>
                    {row.note && <p className="svc-note">{row.note}</p>}
                  </div>
                </div>
                <div className="connect-state">
                  <span className={`status-pill ${row.pillClass}`}><i />{row.pill}</span>
                  {row.action && <a className="secondary-button" href={row.action.href}>{row.action.label}</a>}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="svc-section" aria-label="Features">
          <div className="svc-heading"><h2>What you get</h2><p>One workspace instead of five apps, five logins, and five chances to forget to post.</p></div>
          <div className="svc-feature-grid">
            {featureCards.map((card) => (
              <article className="svc-feature-card" key={card.title}>
                <span className="svc-feature-icon"><card.Icon /></span>
                <div><h3>{card.title}</h3><p>{card.body}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className="how-section" id="how-it-works">
          <h2>How it works</h2>
          <p>Three steps. No developer setup, no juggling logins.</p>
          <div className="steps-grid">
            <div className="step-card">
              <span className="step-num">1</span>
              <h3>Connect your accounts</h3>
              <p>Link each social account once with its official login. Zepostia never sees your passwords.</p>
            </div>
            <div className="step-card">
              <span className="step-num">2</span>
              <h3>Write once</h3>
              <p>Compose a single post. Zepostia adapts it to each platform&apos;s rules before it goes out.</p>
            </div>
            <div className="step-card">
              <span className="step-num">3</span>
              <h3>Schedule &amp; post</h3>
              <p>Publish right away or queue it for later. Your posts go out on time, every time.</p>
            </div>
          </div>
        </section>

        <section className="svc-section" id="pricing" aria-label="Pricing">
          <div className="svc-heading"><h2>One plan. One add-on.</h2><p>Start with the plan — every platform above except X is in it. Add X posting only if you want it.</p></div>
          <div className="billing-block svc-pricing">
            <div className="billing-card">
              <div className="billing-card-icon" aria-hidden="true"><IconCard /></div>
              <div className="billing-card-main">
                <h2>Zepostia plan</h2>
                <p className="billing-price">$19.88/month <small>billed monthly</small></p>
                <p className="billing-trial">14-day free trial — your card is charged $19.88 on day 15. Cancel anytime.</p>
                <a className="primary-button" href="/?auth=signup">Start free trial</a>
              </div>
              <ul className="billing-perks">
                <li><span className="trust-check"><IconCheck /></span>Facebook, Instagram, TikTok &amp; YouTube</li>
                <li><span className="trust-check"><IconCheck /></span>Scheduling and post history</li>
                <li><span className="trust-check"><IconCheck /></span>Cancel anytime</li>
              </ul>
            </div>
            <div className="x-addon-card">
              <div className="billing-card-icon" aria-hidden="true"><IconBolt /></div>
              <div className="x-addon-main">
                <h3>X (Twitter) posting — Add-on</h3>
                <p>X charges per post, so X posting runs on its own tier with monthly caps. Plain posts and posts with links count separately, and posting pauses at the cap — you never get a surprise bill.</p>
                <ul className="x-tier-list">
                  <li><span><strong>Tier 1</strong> — 100 posts · 25 link posts / month</span><strong>$15/month</strong></li>
                  <li><span><strong>Tier 2</strong> — 300 posts · 75 link posts / month</span><strong>$30/month</strong></li>
                  <li><span><strong>Tier 3</strong> — 1,000 posts · 250 link posts / month</span><strong>$100/month</strong></li>
                </ul>
                <p className="x-addon-line">Pick a tier at checkout, or add one any time later on the Billing page. Tiers bill from day one — they are never part of the free trial.</p>
              </div>
            </div>
            <p className="billing-support">Questions about billing? Contact our <a href="mailto:zepostia@cryptobagtracker.io">support team</a>.</p>
          </div>
        </section>

        <section className="svc-section" aria-label="Frequently asked questions">
          <div className="svc-heading"><h2>Frequently asked questions</h2></div>
          <div className="help-cards svc-faq">
            {faqs.map((faq) => (
              <details className="help-card" key={faq.q}>
                <summary><strong>{faq.q}</strong><span className="summary-chev"><IconChevron /></span></summary>
                <p>{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="svc-cta">
          <h2>Write once. Post everywhere.</h2>
          <p>Connect your first account in minutes — your first 14 days are free.</p>
          <a className="primary-button hero-cta" href="/?auth=signup">Get Started</a>
          <p className="svc-support">Questions first? Contact support at <a href="mailto:zepostia@cryptobagtracker.io">zepostia@cryptobagtracker.io</a>.</p>
        </section>
      </main>
      <footer className="landing-footer">
        <div className="footer-brand"><BrandMark className="brand-mark" /><strong>zepostia</strong></div>
        <p>&copy; 2026 zepostia. All rights reserved.</p>
        <nav aria-label="Footer"><a href="/services">Services</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav>
      </footer>
    </div>
  );
}

export function App() {
  const pathname = window.location.pathname;
  const demoMode = useServerDemoMode();
  if (pathname === "/services") return <ServicesPage />;
  if (pathname === "/terms") return <TermsPage />;
  if (pathname === "/privacy") return <PrivacyPage />;
  if (pathname === "/reset") return <ResetPasswordPage />;
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem("marketing-app-session") ?? "");
  const [page, setPage] = useState<Page>(() => pageFromPath(pathname));
  const [toast, setToast] = useState("");
  const queryClient = useQueryClient();
  const workspace = useQuery({
    queryKey: ["workspace", sessionToken],
    queryFn: () => api.getWorkspace({ sessionToken }),
    enabled: Boolean(sessionToken),
  });
  const settings = useQuery({
    queryKey: ["settings", sessionToken],
    queryFn: () => api.listPlatformSettings({ sessionToken }),
    enabled: Boolean(sessionToken),
  });
  const billing = useQuery({
    queryKey: ["billing", sessionToken],
    queryFn: () => api.getBillingStatus({ sessionToken }),
    enabled: Boolean(sessionToken),
    retry: false,
  });
  // X appears as a platform only when the add-on is configured
  // (STRIPE_X_TIERS) or this workspace already has a tier. Server truth
  // only — when neither holds, no X UI renders anywhere.
  const xVisible = Boolean(billing.data?.xAddon && (billing.data.xAddon.configured || billing.data.xAddon.activeTier));
  // Configured but no tier yet: the Accounts X tile shows, but its action
  // routes to the Billing add-on section instead of an OAuth flow.
  const xNeedsTier = Boolean(billing.data?.xAddon?.configured && !billing.data.xAddon.activeTier);

  useEffect(() => {
    if (workspace.data && !workspace.data.authenticated) {
      localStorage.removeItem("marketing-app-session");
      setSessionToken("");
    }
  }, [workspace.data]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  // Facebook OAuth lands back here via /oauth/facebook/callback -> /?oauth=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    if (oauth === "facebook_ok") setToast("Facebook connected — posting as your Page.");
    else if (oauth === "facebook_error") setToast(`Facebook connection failed: ${params.get("reason") ?? "unknown error"}`);
    else if (oauth === "instagram_ok") setToast("Instagram connected — posting as your professional account.");
    else if (oauth === "instagram_error") setToast(`Instagram connection failed: ${params.get("reason") ?? "unknown error"}`);
    else if (oauth === "tiktok_ok") setToast("TikTok connected — ready to post video.");
    else if (oauth === "tiktok_error") setToast(`TikTok connection failed: ${params.get("reason") ?? "unknown error"}`);
    else if (oauth === "youtube_ok") setToast("YouTube connected — ready to upload video.");
    else if (oauth === "youtube_error") setToast(`YouTube connection failed: ${params.get("reason") ?? "unknown error"}`);
    else if (oauth === "x_ok") setToast("X connected — ready to post tweets.");
    else if (oauth === "x_error") setToast(`X connection failed: ${params.get("reason") ?? "unknown error"}`);
    else return;
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // In-app navigation keeps the address bar in sync with the view.
  const go = (next: Page) => {
    setPage(next);
    const path = PAGE_PATHS[next];
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
  };
  // Browser back/forward switches the view to match the URL.
  useEffect(() => {
    const onPopState = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  // Every view switch re-reads the workspace, so each view renders the
  // CURRENT channels/posts rather than a snapshot from an earlier view.
  const isFirstPage = useRef(true);
  useEffect(() => {
    if (isFirstPage.current) {
      isFirstPage.current = false;
      return;
    }
    if (sessionToken) void queryClient.invalidateQueries({ queryKey: ["workspace", sessionToken] });
  }, [page, sessionToken, queryClient]);

  const authenticate = (token: string) => { localStorage.setItem("marketing-app-session", token); setSessionToken(token); };
  const signOut = () => { localStorage.removeItem("marketing-app-session"); setSessionToken(""); setPage("dashboard"); window.history.replaceState({}, "", "/"); };

  if (!sessionToken) return <AuthScreen onAuthenticated={authenticate} />;
  if (workspace.isPending || settings.isPending) return <div className="loading-screen"><SafeAreaTopScrim backgroundColor="var(--bg)" /><span className="loading-mark">///</span><p>Opening control room…</p></div>;
  if (workspace.error || !workspace.data?.authenticated) return <div className="loading-screen"><p>We could not open this workspace.</p><button className="secondary-button" onClick={signOut}>Return to sign in</button></div>;

  const data = workspace.data;
  const user = data.user;
  if (!user) return null;
  return <div className="app-shell">
    <SafeAreaTopScrim backgroundColor="var(--bg)" />
    <header className="mobile-header">
      <strong className="mobile-brand"><BrandMark className="brand-mark" />zepostia<span aria-hidden="true">///</span></strong>
      <div className="mobile-status">{demoMode && <><span className="live-dot" /><span>Demo</span></>}<button aria-label="Sign out" title="Sign out" onClick={signOut}><IconLogout /></button><button aria-label="Open settings" onClick={() => go("settings")}><IconGear /></button></div>
    </header>
    <aside className="side-rail">
      <div className="rail-brand"><BrandMark className="brand-mark" />zepostia<span aria-hidden="true">///</span></div>
      {demoMode && <div className="mode-stamp"><span className="live-dot" /><strong>DEMO</strong><small>official APIs only</small></div>}
      <nav aria-label="Primary navigation">{NAV.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => go(item.id)}><span className="nav-icon"><item.Icon /></span>{item.label}</button>)}</nav>
      <div className="rail-user">
        <div className="rail-user-card"><span className="rail-avatar" aria-hidden="true">{user.displayName.trim().charAt(0).toUpperCase() || "Z"}</span><span className="rail-user-text"><strong>{user.displayName}</strong><small>{user.email}</small></span></div>
        <button className="rail-signout" onClick={signOut}><IconLogout /><span>Sign out</span></button>
      </div>
    </aside>
    <main className="main-canvas">
      {page === "dashboard" && <Dashboard accounts={data.accounts} posts={data.posts} go={go} xVisible={xVisible} />}
      {page === "post" && <PostPage accounts={data.accounts} posts={data.posts} token={sessionToken} onMessage={setToast} goAccounts={() => go("accounts")} xVisible={xVisible} />}
      {page === "accounts" && <Accounts accounts={data.accounts} settings={settings.data?.platforms ?? []} token={sessionToken} onMessage={setToast} xVisible={xVisible} xNeedsTier={xNeedsTier} goBilling={() => go("billing")} goHelp={() => go("help")} />}
      {page === "billing" && <BillingPage token={sessionToken} onMessage={setToast} go={go} />}
      {page === "help" && <HelpPage go={go} xVisible={xVisible} />}
      {page === "settings" && <Settings settings={settings.data?.platforms ?? []} token={sessionToken} user={user} metaConfigured={settings.data?.metaConfigured ?? false} tiktokConfigured={settings.data?.tiktokConfigured ?? false} youtubeConfigured={settings.data?.youtubeConfigured ?? false} xConfigured={settings.data?.xConfigured ?? false} xPostsUsed={settings.data?.xPostsUsed ?? 0} xPostsCap={settings.data?.xPostsCap ?? 60} tiktokPostsUsed={settings.data?.tiktokPostsUsed ?? 0} tiktokPostsCap={settings.data?.tiktokPostsCap ?? 60} xVisible={xVisible} onMessage={setToast} onSignOut={signOut} go={go} />}
    </main>
    <nav className="bottom-nav" aria-label="Primary navigation">{NAV.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => go(item.id)}><item.Icon /><small>{item.label}</small></button>)}</nav>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
