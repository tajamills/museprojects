// CryptoBagTracker icon family — one hand-drawn inline-SVG set.
// Every mark shares: 24x24 viewBox, 1.9px stroke, rounded caps/joins,
// no fill, currentColor stroke (the theme palette drives the color).
// Illustrations (empty states) share the same language on a 64x64 grid
// with a proportionally scaled 3px stroke.

import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

function Icon({ size = 20, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* ---------- Brand mark (matches favicon.svg) ---------- */

export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#07110f" />
      <path d="M25.5 25v-3.5a6.5 6.5 0 0 1 13 0V25" fill="none" stroke="#52e6a5" strokeWidth={4} strokeLinecap="round" />
      <path d="M19.5 25h25l-2.3 24.4a6 6 0 0 1-6 5.1H27.8a6 6 0 0 1-6-5.1Z" fill="#52e6a5" />
      <rect x="25.6" y="39.5" width="3.6" height="6.5" rx="1.4" fill="#07110f" />
      <rect x="30.2" y="36" width="3.6" height="10" rx="1.4" fill="#07110f" />
      <rect x="34.8" y="32.5" width="3.6" height="13.5" rx="1.4" fill="#07110f" />
    </svg>
  );
}

/* ---------- Navigation / UI icons ---------- */

export function DashboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.6" y="3.6" width="7" height="7" rx="2" />
      <rect x="13.4" y="3.6" width="7" height="7" rx="2" />
      <rect x="3.6" y="13.4" width="7" height="7" rx="2" />
      <rect x="13.4" y="13.4" width="7" height="7" rx="2" />
    </Icon>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.8 7.4A2.8 2.8 0 0 1 6.6 4.6h10.8a2.8 2.8 0 0 1 2.8 2.8v9.2a2.8 2.8 0 0 1-2.8 2.8H6.6a2.8 2.8 0 0 1-2.8-2.8Z" />
      <path d="M3.8 9.3h16.4" />
      <circle cx="16.4" cy="14.9" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function SwapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.8h12.6" />
      <path d="M13.9 3.6 17.1 6.8l-3.2 3.2" />
      <path d="M20 17.2H7.4" />
      <path d="M10.1 14l-3.2 3.2 3.2 3.2" />
    </Icon>
  );
}

export function TaxIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.6" y="3" width="12.8" height="18" rx="2.2" />
      <path d="M8.6 6.7h6.8" />
      <path d="M8.8 11.3h.2M12 11.3h.2M15.2 11.3h.2M8.8 14.7h.2M12 14.7h.2M15.2 14.7h.2M8.8 18.1h.2M12 18.1h.2M15.2 18.1h.2" />
    </Icon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.1 8.3a5.9 5.9 0 0 1 11.8 0c0 6.2 2.7 8.2 2.7 8.2H3.4s2.7-2 2.7-8.2" />
      <path d="M10.3 20.2a1.95 1.95 0 0 0 3.4 0" />
    </Icon>
  );
}

export function CardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5.4" width="18" height="13.2" rx="2.6" />
      <path d="M3 10.1h18" />
      <path d="M6.4 14.8h3.6" />
    </Icon>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="12" r="2.7" />
      <circle cx="17.6" cy="5.7" r="2.7" />
      <circle cx="17.6" cy="18.3" r="2.7" />
      <path d="M8.5 10.7l6.5-3.6M8.5 13.3l6.5 3.6" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.6 12h16" />
      <path d="M14 5.9l6.1 6.1-6.1 6.1" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.6 12.6l5.2 5.2L19.4 6.9" />
    </Icon>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.2 5.2 5.7v5.5c0 4.5 2.9 7.5 6.8 9.6 3.9-2.1 6.8-5.1 6.8-9.6V5.7Z" />
      <path d="M9.1 11.7l2.1 2.1 3.9-4.1" />
    </Icon>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.2 3.8V19a1 1 0 0 0 1 1h14.6" />
      <path d="M8.2 16.2v-4.6M12.4 16.2V8M16.6 16.2V5.8" />
    </Icon>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
    </Icon>
  );
}

export function SendPlaneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20.4 3.9 4.1 10.7l5.2 2 2.1 5.7 2.9-4 4.6 3.3Z" />
      <path d="M11.3 12.7l9.1-8.8" />
    </Icon>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.8 4H20v6.2" />
      <path d="M19.4 4.6 11 13" />
      <path d="M19 13.4v5A1.6 1.6 0 0 1 17.4 20H6.6A1.6 1.6 0 0 1 5 18.4V7.6A1.6 1.6 0 0 1 6.6 6h5" />
    </Icon>
  );
}

export function CoinsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <ellipse cx="12" cy="7.8" rx="7" ry="2.8" />
      <path d="M5 7.8v8.2c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V7.8" />
      <path d="M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.6V12l3.1 2" />
    </Icon>
  );
}

export function RouteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5.8" cy="18.2" r="2.3" />
      <circle cx="18.2" cy="5.8" r="2.3" />
      <path d="M5.8 15.9c0-5.4 9.9-5.1 11.9-7.9" strokeDasharray="0.1 3.4" />
      <path d="M15.2 6.9l2.3 1.2 1-2.4" />
    </Icon>
  );
}

export function LedgerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.8 4.6A1.6 1.6 0 0 1 7.4 3h11.8v15H7.4a1.6 1.6 0 0 0-1.6 1.6Z" />
      <path d="M5.8 19.6A1.6 1.6 0 0 1 7.4 18h11.8v3H7.4a1.6 1.6 0 0 1-1.6-1.4Z" />
      <path d="M9.4 8h5.4M9.4 11.6h5.4" />
    </Icon>
  );
}

/* ---------- Transaction-type marks (timeline) ---------- */

export function BuyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.8v10.4" />
      <path d="M6.9 9.6 12 14.7l5.1-5.1" />
      <path d="M4.4 19.8h15.2" />
    </Icon>
  );
}

export function SellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 14.2V3.8" />
      <path d="M6.9 8.9 12 3.8l5.1 5.1" />
      <path d="M4.4 19.8h15.2" />
    </Icon>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.6 18.4 18.4 5.6" />
      <path d="M9.8 5.6h8.6v8.6" />
    </Icon>
  );
}

export function ReceiveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18.4 5.6 5.6 18.4" />
      <path d="M14.2 18.4H5.6V9.8" />
    </Icon>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.6 21 8.7l-9 5.1-9-5.1Z" />
      <path d="M3.6 13.3 12 18l8.4-4.7" />
    </Icon>
  );
}

export function GiftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 10.6h16v3.6H4z" />
      <path d="M5.8 14.2h12.4V20H5.8z" />
      <path d="M12 10.6V20" />
      <path d="M12 10.6c-2.9 0-4.3-1.7-3.5-3.2.7-1.4 3-1 3.4.9.1.7.1 2.3.1 2.3Zm0 0c2.9 0 4.3-1.7 3.5-3.2-.7-1.4-3-1-3.4.9-.1.7-.1 2.3-.1 2.3Z" />
    </Icon>
  );
}

export function TxTypeIcon({ type, size = 16 }: { type: string; size?: number }) {
  switch (type) {
    case "BUY": return <BuyIcon size={size} />;
    case "SELL": return <SellIcon size={size} />;
    case "TRADE": return <SwapIcon size={size} />;
    case "SEND": return <SendIcon size={size} />;
    case "RECEIVE": return <ReceiveIcon size={size} />;
    case "STAKING": return <LayersIcon size={size} />;
    case "AIRDROP": return <GiftIcon size={size} />;
    default: return <SwapIcon size={size} />;
  }
}

/* ---------- Empty-state illustrations (64x64, same stroke language) ---------- */

function Art({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={64}
      height={64}
      className="empty-art"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function CoinsArt() {
  return (
    <Art>
      <ellipse cx="28" cy="19" rx="16" ry="5.5" />
      <path d="M12 19v9c0 3 7.2 5.5 16 5.5S44 31 44 28v-9" />
      <path d="M12 35v10c0 3 7.2 5.5 16 5.5S44 48 44 45V35" />
      <path d="M12 35c0 3 7.2 5.5 16 5.5S44 38 44 35" />
      <circle cx="49" cy="13" r="9.5" fill="var(--accent)" stroke="none" />
      <path d="M49 9v8M45 13h8" stroke="var(--accent-ink)" />
    </Art>
  );
}

export function LedgerArt() {
  return (
    <Art>
      <rect x="12" y="6" width="35" height="51" rx="4.5" />
      <path d="M19.5 6v51" />
      <path d="M27 19h12M27 28h12M27 37h8" />
      <circle cx="47" cy="46" r="11.5" fill="var(--surface)" />
      <path d="M47 39v7l4.8 3" />
    </Art>
  );
}

export function WalletArt() {
  return (
    <Art>
      <path d="M14 15v-2.5A4.5 4.5 0 0 1 18.5 8h25A4.5 4.5 0 0 1 48 12.5V15" />
      <path d="M8 20.5A5.5 5.5 0 0 1 13.5 15h37A5.5 5.5 0 0 1 56 20.5v25A5.5 5.5 0 0 1 50.5 51h-37A5.5 5.5 0 0 1 8 45.5Z" />
      <path d="M8 26h48" />
      <circle cx="46.5" cy="38.5" r="2.6" fill="currentColor" stroke="none" />
    </Art>
  );
}

export function ExchangeArt() {
  return (
    <Art>
      <rect x="9" y="9" width="46" height="46" rx="11" />
      <path d="M40.5 23.5a9.5 9.5 0 0 0-15.8 1.8" />
      <path d="M24.2 19.8v6h6" />
      <path d="M23.5 40.5a9.5 9.5 0 0 0 15.8-1.8" />
      <path d="M39.8 44.2v-6h-6" />
    </Art>
  );
}

export function ListArt() {
  return (
    <Art>
      <path d="M19 5h26v54l-4.4-3.3-4.3 3.3-4.3-3.3-4.3 3.3-4.4-3.3L19 59Z" />
      <path d="M26 17h12M26 26.5h12M26 36h7.5" />
    </Art>
  );
}

export function LayersArt() {
  return (
    <Art>
      <path d="M32 7 57 20.5 32 34 7 20.5Z" />
      <path d="M10.8 31.5 32 42.8l21.2-11.3" />
      <path d="M10.8 42.5 32 53.8l21.2-11.3" />
    </Art>
  );
}

export function RouteArt() {
  return (
    <Art>
      <circle cx="16" cy="50" r="5.5" />
      <circle cx="48" cy="14" r="5.5" />
      <path d="M16 44.5C16 31.5 48 33.5 48 21" strokeDasharray="0.1 8.5" />
      <path d="M43.8 25.5 48 20.8l4.2 4.7" />
      <circle cx="48" cy="48" r="11" fill="var(--surface)" />
      <path d="M43.2 48.3l3.4 3.4 6-6.8" />
    </Art>
  );
}

export function BellArt() {
  return (
    <Art>
      <path d="M32 12.5a14.5 14.5 0 0 1 14.5 14.5c0 7.8 2.4 10.7 3.9 12.8H13.6c1.5-2.1 3.9-5 3.9-12.8A14.5 14.5 0 0 1 32 12.5Z" />
      <path d="M32 12.5V9" />
      <path d="M26.3 46.5a5.9 5.9 0 0 0 11.4 0" />
      <path d="M10.5 20a17 17 0 0 1 3.2-6M53.5 20a17 17 0 0 0-3.2-6" />
    </Art>
  );
}

export function HistoryArt() {
  return (
    <Art>
      <path d="M7.8 7.8v13h13" />
      <path d="M7.8 31.2a23.4 23.4 0 1 0 23.4-23.4 25.4 25.4 0 0 0-17.5 7.1L7.8 20.8" />
      <path d="M31.2 18.2v13l10.4 5.2" />
    </Art>
  );
}

export type EmptyArtKind = "coins" | "ledger" | "wallet" | "exchange" | "list" | "layers" | "route" | "bell" | "history";

export function EmptyArt({ kind }: { kind: EmptyArtKind }) {
  switch (kind) {
    case "coins": return <CoinsArt />;
    case "ledger": return <LedgerArt />;
    case "wallet": return <WalletArt />;
    case "exchange": return <ExchangeArt />;
    case "list": return <ListArt />;
    case "layers": return <LayersArt />;
    case "route": return <RouteArt />;
    case "bell": return <BellArt />;
    case "history": return <HistoryArt />;
  }
}
