// Reviewed seed data for the Stolen-Funds Watch — Binance case.
// Source of truth: the Oct 31, 2026 case file
// (binance-breach-reported-addresses-oct31.md) and the Oct 31, 2026 bounty
// landscape review. Every address below was printed in full in an
// identifiable published source listed in SEED_SOURCES. Role text on
// watch_addresses is neutral service wording ("reported ..."); the source's
// own wording is preserved verbatim in reportedRoleText /
// reportedSnapshotText (spec §4.3). No shortened form appears here; the
// transaction hashes printed in the case file are listed separately in
// KNOWN_SOURCE_TX_HASHES and are never imported as addresses (spec §11.1).

export const SEED_VERSION = "2026-11-03-casefile-oct31-v1";
export const CASE_SLUG = "binance-hot-wallet-breach-2026";

export interface SeedSource {
  key: string;
  publisher: string;
  title: string;
  url: string;
  sourceType: string;
  publishedAt: string | null;
}

export const SEED_SOURCES: SeedSource[] = [
  { key: "bitquery", publisher: "Bitquery", title: "Binance $6.36B Hack: Attacker Wallets Traced as Bitquery Releases Full Address List", url: "https://bitquery.io/investigations/binance-hack", sourceType: "analytics_report", publishedAt: "2026-10-31" },
  { key: "yoursaudit", publisher: "yoursAudit", title: "Binance hack details (on-chain trace, Medium)", url: "https://medium.com/@yoursaudit/binance-hack-details-283673ac0418", sourceType: "investigator_report", publishedAt: "2026-10-30" },
  { key: "trm", publisher: "TRM Labs", title: "North Korea Steals USD 6.36 Billion from Binance in the Largest Hack in History", url: "https://www.trmlabs.com/resources/blog/north-korea-steals-usd-6-36-billion-from-binance-in-the-largest-hack-in-history", sourceType: "analytics_report", publishedAt: "2026-10-30" },
  { key: "elliptic", publisher: "Elliptic", title: "Binance Hack 2026 Blocklist", url: "https://www.elliptic.co/binance-hack-2026-blocklist/", sourceType: "analytics_report", publishedAt: "2026-10-31" },
  { key: "oak", publisher: "OAK / Ondology", title: "2026-10 Binance DevOps Laptop Service-Container Hot Wallet Drain", url: "https://onchainattack.org/document/examples/2026-10-binance-devops-laptop-service-container-hot-wallet-drain/", sourceType: "investigator_report", publishedAt: "2026-10-30" },
  { key: "zachxbt_coinscreamer", publisher: "ZachXBT (reported via CoinScreamer)", title: "ZachXBT: Binance–Bitget TraderTraitor wallet link", url: "https://coinscreamer.com/briefs/zachxbt-binance-bitget-tradertraitor-wallet-link/", sourceType: "investigator_report", publishedAt: "2026-10-30" },
  { key: "zachxbt_disruption", publisher: "ZachXBT (reported via Disruption Banking)", title: "Binance Hack Update: Arbitrum Security Council Freezes $30.5M", url: "https://www.disruptionbanking.com/2026/10/30/binance-hack-update-arbitrum-security-council-freezes-30-5m/", sourceType: "news_report", publishedAt: "2026-10-30" },
  { key: "socradar", publisher: "SOCRadar", title: "Binance Hack: $6.3B Hot Wallet Theft", url: "https://socradar.io/blog/binance-hack-6-3b-hot-wallet-theft/", sourceType: "news_report", publishedAt: "2026-10-30" },
  { key: "fathom", publisher: "Fathom", title: "Binance Hacker $484M Ether Laundering Trail", url: "https://www.fathom.news/binance-hacker-484m-ether-laundering-trail/", sourceType: "news_report", publishedAt: "2026-10-30" },
  { key: "thenewscrypto", publisher: "TheNewsCrypto", title: "The Binance Hack Breakdown: How Attackers Breached the Exchange and Moved the Funds", url: "https://thenewscrypto.com/the-binance-hack-breakdown-how-attackers-breached-the-exchange-and-moved-the-stolen-funds/", sourceType: "news_report", publishedAt: "2026-10-30" },
  { key: "chainalysis", publisher: "Chainalysis", title: "Binance Exploit: Latest Findings and Response", url: "https://www.chainalysis.com/blog/binance-exploit-latest-findings-and-response/", sourceType: "analytics_report", publishedAt: "2026-10-31" },
  { key: "reuters", publisher: "Reuters", title: "Reporting of October 29, 2026 issuer freeze figures (Tether / Circle statements)", url: "https://www.reuters.com", sourceType: "news_report", publishedAt: "2026-10-29" },
  { key: "cryptonews", publisher: "CryptoNews", title: "Coverage of the Paxos PAXG freeze figure", url: "https://cryptonews.com", sourceType: "news_report", publishedAt: "2026-10-30" },
  { key: "coincentral", publisher: "CoinCentral", title: "Coverage carrying the Chainalysis $6.4B incident figure", url: "https://coincentral.com", sourceType: "news_report", publishedAt: "2026-10-31" },
  { key: "binance", publisher: "Binance", title: "Binance official statements on the incident (impact figure, freeze total, loss-coverage commitment)", url: "https://www.binance.com", sourceType: "official_source", publishedAt: "2026-10-30" },
  { key: "rfj", publisher: "U.S. Department of State — Rewards for Justice", title: "North Korea financial-mechanisms reward offer (up to $5 million)", url: "https://rewardsforjustice.net/rewards/north-korea-ship-to-ship-transfers/", sourceType: "official_source", publishedAt: null },
  { key: "fbi", publisher: "Federal Bureau of Investigation", title: "Cryptocurrency investment fraud — reporting (IC3)", url: "https://www.ic3.gov", sourceType: "official_source", publishedAt: null },
  { key: "bybit", publisher: "Bybit — LazarusBounty", title: "LazarusBounty program (2025 precedent, different case)", url: "https://www.lazarusbounty.com/", sourceType: "official_source", publishedAt: "2025-02-21" },
  { key: "seal", publisher: "Security Alliance — SEAL 911", title: "SEAL 911 reporting channel (no payment)", url: "https://securityalliance.org/our-work", sourceType: "official_source", publishedAt: null },
  { key: "chainabuse", publisher: "Chainabuse", title: "Chainabuse reporting (no payment)", url: "https://chainabuse.com/faq/CONTACT", sourceType: "official_source", publishedAt: null },
];

export interface SeedClaim {
  claimKey: string;
  claimType: string;
  displayLabel: string;
  displayValue: string;
  sourceKey: string;
  sourceLocator: string;
  asOf: string | null;
  displayOrder: number;
}

export const SEED_CLAIMS: SeedClaim[] = [
  { claimKey: "total_binance", claimType: "incident_total", displayLabel: "Funds moved out — Binance", displayValue: "Approximately $6.3 billion", sourceKey: "binance", sourceLocator: "Binance's stated impact figure, as compiled in the case file", asOf: "2026-10-31", displayOrder: 10 },
  { claimKey: "total_trm", claimType: "incident_total", displayLabel: "Funds moved out — TRM", displayValue: "Approximately $6.36 billion across ten blockchains", sourceKey: "trm", sourceLocator: "TRM incident report, Oct 30, 2026", asOf: "2026-10-30", displayOrder: 11 },
  { claimKey: "total_elliptic", claimType: "incident_total", displayLabel: "Funds moved out — Elliptic", displayValue: "$6.43 billion identified (eleven blockchains in its reporting)", sourceKey: "elliptic", sourceLocator: "Elliptic blocklist report, Oct 31, 2026", asOf: "2026-10-31", displayOrder: 12 },
  { claimKey: "total_chainalysis", claimType: "incident_total", displayLabel: "Funds moved out — Chainalysis", displayValue: "Approximately $6.4 billion", sourceKey: "chainalysis", sourceLocator: "Chainalysis figure as carried by CoinCentral (case file introduction)", asOf: "2026-10-31", displayOrder: 13 },
  { claimKey: "loss_coverage", claimType: "coverage_commitment", displayLabel: "Loss coverage — Binance commitment (reported)", displayValue: "Binance stated it reserved approximately $6.34 billion and committed to covering user losses in full. This is a reported commitment, not a verified completion.", sourceKey: "binance", sourceLocator: "Binance statements as reported (case file; Fathom coverage)", asOf: "2026-10-31", displayOrder: 20 },
  { claimKey: "attribution_trm", claimType: "attribution", displayLabel: "Attribution — TRM", displayValue: "TRM reported high confidence that the TraderTraitor cluster (North Korea) carried out the attack", sourceKey: "trm", sourceLocator: "TRM incident report, Oct 30, 2026", asOf: "2026-10-30", displayOrder: 30 },
  { claimKey: "attribution_chainalysis", claimType: "attribution", displayLabel: "Attribution — Chainalysis", displayValue: "Chainalysis assessed with high confidence that North Korea was responsible", sourceKey: "chainalysis", sourceLocator: "Chainalysis incident findings, Oct 31, 2026", asOf: "2026-10-31", displayOrder: 31 },
  { claimKey: "attribution_elliptic", claimType: "attribution", displayLabel: "Attribution — Elliptic", displayValue: "Elliptic assessed the attack as likely North Korean state-sponsored", sourceKey: "elliptic", sourceLocator: "Elliptic blocklist report, Oct 31, 2026", asOf: "2026-10-31", displayOrder: 32 },
  { claimKey: "attribution_zachxbt", claimType: "attribution", displayLabel: "Attribution — ZachXBT", displayValue: "ZachXBT reported the activity as likely Lazarus Group", sourceKey: "zachxbt_coinscreamer", sourceLocator: "ZachXBT wallet-link reporting, Oct 30, 2026", asOf: "2026-10-30", displayOrder: 33 },
  { claimKey: "attribution_government", claimType: "attribution", displayLabel: "Government attribution", displayValue: "No U.S. government or Binance attribution had been published in the sources compiled as of October 31, 2026. The attributions above are firm-reported assessments, not a court or government finding.", sourceKey: "rfj", sourceLocator: "Checked Oct 31, 2026 against the compiled sources (case file §11)", asOf: "2026-10-31", displayOrder: 34 },
  { claimKey: "freeze_tether", claimType: "freeze", displayLabel: "Tether — USDT", displayValue: "More than 1.567B USDT frozen initially; later reporting put the total locked at approximately 1.76–1.77B USDT. The figures are snapshots from different times.", sourceKey: "reuters", sourceLocator: "Reuters, Oct 29, 2026 (Ardoino statement); later totals per Bitquery and the trace (case file §11)", asOf: "2026-10-31", displayOrder: 40 },
  { claimKey: "freeze_circle", claimType: "freeze", displayLabel: "Circle — USDC", displayValue: "823M USDC frozen", sourceKey: "reuters", sourceLocator: "Reuters, Oct 29, 2026 (Allaire statement)", asOf: "2026-10-29", displayOrder: 41 },
  { claimKey: "freeze_ripple_yihe", claimType: "freeze", displayLabel: "Ripple — statement figure", displayValue: "Approximately $200 million (per Yi He)", sourceKey: "binance", sourceLocator: "Yi He statement as compiled in the case file (§11). Shown separately from the trace figure below; the two were never reconciled by the sources and are never added together here.", asOf: "2026-10-31", displayOrder: 42 },
  { claimKey: "freeze_ripple_rlusd", claimType: "freeze", displayLabel: "Ripple — RLUSD (trace freeze summary)", displayValue: "40.5M RLUSD", sourceKey: "yoursaudit", sourceLocator: "Trace freeze summary (case file §11). Shown separately from the statement figure above; never added together.", asOf: "2026-10-31", displayOrder: 43 },
  { claimKey: "freeze_wlfi", claimType: "freeze", displayLabel: "World Liberty Financial — USD1", displayValue: "Approximately $27M–27.8M USD1 blacklisted/frozen", sourceKey: "yoursaudit", sourceLocator: "Company statement and trace range (case file §11)", asOf: "2026-10-31", displayOrder: 44 },
  { claimKey: "freeze_paxos", claimType: "freeze", displayLabel: "Paxos — PAXG", displayValue: "1,906.67 PAXG frozen (more than $8M)", sourceKey: "cryptonews", sourceLocator: "Paxos figure as covered Oct 30, 2026 (case file §11)", asOf: "2026-10-30", displayOrder: 45 },
  { claimKey: "freeze_smaller_tokens", claimType: "freeze", displayLabel: "First Digital and other smaller token freezes", displayValue: "Part of approximately $132M frozen across six smaller tokens; no individual FDUSD amount is given in the sources", sourceKey: "yoursaudit", sourceLocator: "Trace freeze summary (case file §11)", asOf: "2026-10-31", displayOrder: 46 },
  { claimKey: "freeze_arbitrum_council", claimType: "freeze", displayLabel: "Arbitrum Security Council action", displayValue: "8,426 ETH plus 74,559,805 ARB (approximately $30.5M) moved out of the reported Arbitrum address into an intermediary frozen wallet", sourceKey: "zachxbt_disruption", sourceLocator: "ZachXBT first report; Arbitrum confirmation (case file §2)", asOf: "2026-10-30", displayOrder: 47 },
  { claimKey: "freeze_total_binance", claimType: "freeze_total", displayLabel: "Total frozen — Binance", displayValue: "Approximately $3 billion frozen or otherwise secured", sourceKey: "binance", sourceLocator: "Binance statement (case file §11)", asOf: "2026-10-31", displayOrder: 50 },
  { claimKey: "freeze_total_elliptic", claimType: "freeze_total", displayLabel: "Total frozen — Elliptic (verified on-chain)", displayValue: "$2.84 billion verified frozen on-chain (44% of the amount taken)", sourceKey: "elliptic", sourceLocator: "Elliptic blocklist report, Oct 31, 2026", asOf: "2026-10-31", displayOrder: 51 },
  { claimKey: "freeze_total_trm", claimType: "freeze_total", displayLabel: "Total frozen — TRM snapshot", displayValue: "Approximately $2.7 billion locked as of TRM's October 30, 2026, 00:30 UTC snapshot", sourceKey: "trm", sourceLocator: "TRM incident report (case file §11)", asOf: "2026-10-30", displayOrder: 52 },
  { claimKey: "bounty_rfj", claimType: "bounty", displayLabel: "Rewards for Justice — North Korea financial mechanisms", displayValue: "Up to $5 million for information that disrupts the financial mechanisms of persons engaged in sanctioned North Korea activity. Payment is discretionary and is not a per-address bounty; republishing already-public addresses is unlikely to qualify on its own.", sourceKey: "rfj", sourceLocator: "Rewards for Justice program pages, checked Oct 31, 2026", asOf: "2026-10-31", displayOrder: 60 },
  { claimKey: "bounty_binance_state", claimType: "bounty", displayLabel: "Binance case-specific bounty", displayValue: "No Binance bounty for this case has been posted in the sources checked.", sourceKey: "binance", sourceLocator: "Checked Oct 31, 2026 across Binance's site and the compiled coverage (bounty landscape review, Oct 31, 2026). Binance's 2018 hack bounty is historical and is not a live offer for this case.", asOf: "2026-10-31", displayOrder: 61 },
  { claimKey: "bounty_bybit_precedent", claimType: "bounty", displayLabel: "Precedent only — Bybit LazarusBounty (2025, a different case)", displayValue: "A 10% pool of frozen value: 5% to the party whose report led to a freeze and 5% to the first reporter. Bybit reported paying more than $2.2M to 12 hunters. These are Bybit's reported figures, not independently audited, and this program does not cover the Binance case.", sourceKey: "bybit", sourceLocator: "Bybit LazarusBounty program pages (bounty landscape review, Oct 31, 2026)", asOf: "2026-10-31", displayOrder: 62 },
];

export interface SeedAddressLink {
  sourceKey: string;
  locator: string;
}

export interface SeedAddress {
  address: string;
  displayAddress: string;
  chain: string;
  section: "reported" | "victim_owned";
  roleText: string | null;
  reportedRoleText: string | null;
  reportedSnapshotText: string | null;
  anchor: boolean;
  frozenState: string | null;
  caseSection: string;
  sourceLinks: SeedAddressLink[];
}

/** Transaction hashes printed in the case file (§9) plus the shortened
 * transaction reference in §12. These are NOT addresses: the importer reports
 * them as rejected-at-curation and refuses them if they ever appear in the
 * address list. */
export const KNOWN_SOURCE_TX_HASHES: string[] = [
  "0xad99264d5532ae0dd04b2004eebda05f25657e70dacb764f7ac8d4ccd051298b",
  "0x53bd38b816c23e74134786c29a8c18d792777998a3b9326047b583100e88e2f3",
  "0xafbf94c92a8d749988411669fa14d4f8866d9b4420b4ebd299f28e958dac7209",
  "0x7baba482077843514d9c72bac0110ba0916b0814288a72917e2c3bb27a9d8659",
  "0xb69c81774f507d46ce776aeaed8b4d31df96dd66ce6fd05073481011835355d6",
  "0x9edf86533e73658700c5dadb2432dd7bebb628dc0f5fe37991c241f537856071",
  "0x38546f9087ba0eb8444965711eb64a89fe9f53e80cd6d416317c847308219164",
  "0x410af166c81f9c0f26cc19b4d970c984f526225eeea2aea169179856fd615f70",
  "73c7102b3d3443d2e66deb76bb680b6463a86d2db5cc5e7018a8ce5548f80318",
  "55abdfbd684ad3f49323390964297098692ac189874a6ee6fe9b0b00de816070",
  "0x51f263fa…d39f", // shortened transaction reference (case file §12) — not an address
];

export const SEED_ADDRESSES: SeedAddress[] = [
 {
  "address": "0x7c8601d4645b93cea45f71e118a729332e6b5ca0",
  "chain": "ethereum",
  "section": "reported",
  "roleText": "Reported operator / initiator address; reported as the owner of the sweeper contract; reported as funded by Tornado Cash withdrawals on Oct 28",
  "reportedRoleText": "Attacker operator / initiator EOA; `owner()` of the sweeper contract; funded by Tornado Cash withdrawals on Oct 28",
  "reportedSnapshotText": "1.1776 ETH at trace time",
  "anchor": true,
  "caseSection": "1. Ethereum",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a71 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x7c8601d4645b93cea45f71e118a729332e6b5ca0"
 },
 {
  "address": "0x63e842b054bd624a465454d533c33f573e9c6fae",
  "chain": "ethereum",
  "section": "reported",
  "roleText": "Reported sweeper contract, deployed by the reported operator address; the code a Binance hot wallet was reported to have been made to run via EIP-7702 delegation",
  "reportedRoleText": "Sweeper contract deployed by the attacker; the code Binance 14 was made to run via EIP-7702 delegation",
  "reportedSnapshotText": "Contract",
  "anchor": false,
  "caseSection": "1. Ethereum",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a71 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x63e842b054bd624a465454d533c33f573e9c6fae"
 },
 {
  "address": "0x5227f603c1ee34ce3c06efe6477003bdfccb2f8c",
  "chain": "ethereum",
  "section": "reported",
  "roleText": "Main reported receiving wallet (\"drain1\") \u2014 reported as receiving both Ethereum sweeps",
  "reportedRoleText": "Main receiving wallet (\"drain1\") \u2014 received both Ethereum sweeps (167,464 ETH + ~1.615B USDT in sweep #1)",
  "reportedSnapshotText": "0 ETH; 1,175.46M USDT + 823M USDC, frozen (trace snapshot). Bitquery at 16:51 UTC Oct 31: under 1 ETH plus frozen stablecoins and gold tokens; it had sent its ETH to a new wallet at 05:15 UTC Oct 30 and kept selling small tokens",
  "anchor": true,
  "caseSection": "1. Ethereum",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a71 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   },
   {
    "sourceKey": "socradar",
    "locator": "Case file \u00a71 \u2014 SOCRadar snapshot (checksummed display form)"
   }
  ],
  "frozenState": "Reported frozen in place on Ethereum \u2014 Tether and Circle freezes were reported against this address's stablecoin balances",
  "displayAddress": "0x5227f603C1eE34CE3C06eFe6477003BDfCCB2f8c"
 },
 {
  "address": "0xa97bf7836f8a08f9ed91d41453d371493fae8d10",
  "chain": "ethereum",
  "section": "reported",
  "roleText": "Second reported receiving wallet (\"drain2\") \u2014 reported as receiving part of sweep #2",
  "reportedRoleText": "Second receiving wallet (\"drain2\")",
  "reportedSnapshotText": "0.3652 ETH (trace); Bitquery: sent its ETH to a stash at 06:36 UTC Oct 30, holds unsold tokens",
  "anchor": true,
  "caseSection": "1. Ethereum",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a71 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xa97bf7836f8a08f9ed91d41453d371493fae8d10"
 },
 {
  "address": "0x8532fa14acaf483729c449b8458aeddb900543d4",
  "chain": "ethereum",
  "section": "reported",
  "roleText": "Largest reported ETH stash \u2014 reported as never having sent a transaction",
  "reportedRoleText": "Largest ETH stash wallet; received ~195,460 ETH from the main receiver at 20:38 UTC Oct 29 (SOCRadar); labeled \"Binance Hot Wallet Exploiter 8\" on Etherscan (per SOCRadar)",
  "reportedSnapshotText": "197,460 ETH; never sent a transaction (Bitquery, 16:51 UTC Oct 31; OAK: 197,460 ETH as of Oct 30 06:25 UTC)",
  "anchor": true,
  "caseSection": "1. Ethereum",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a71 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x8532fa14acaf483729c449b8458aeddb900543d4"
 },
 {
  "address": "0xc887af690e0301cd4edbbce8f8d31b4ec65b286a",
  "chain": "ethereum",
  "section": "reported",
  "roleText": "Reported ETH consolidation / stash address \u2014 reported as never having sent a transaction",
  "reportedRoleText": "ETH consolidation / stash wallet",
  "reportedSnapshotText": "137,602 ETH; never sent a transaction (Bitquery, Oct 31 16:51 UTC)",
  "anchor": true,
  "caseSection": "1. Ethereum",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a71 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xc887af690e0301cd4edbbce8f8d31b4ec65b286a"
 },
 {
  "address": "0x897c80d1a9729e94460e2bd93178bd5215158df3",
  "chain": "ethereum",
  "section": "reported",
  "roleText": "Reported ETH stash address \u2014 reported as never having sent a transaction",
  "reportedRoleText": "ETH consolidation / stash wallet",
  "reportedSnapshotText": "78,415 ETH; never sent a transaction (Bitquery)",
  "anchor": true,
  "caseSection": "1. Ethereum",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a71 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x897c80d1a9729e94460e2bd93178bd5215158df3"
 },
 {
  "address": "0x54401f80da97893a15d43566184635b6674bc942",
  "chain": "ethereum",
  "section": "reported",
  "roleText": "Reported ETH stash address",
  "reportedRoleText": "ETH consolidation / stash wallet",
  "reportedSnapshotText": "40,600.6718 ETH (trace); Bitquery's table printed it shortened (`0x5440\u2026c942`) at 40,601 ETH",
  "anchor": false,
  "caseSection": "1. Ethereum",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a71 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x54401f80da97893a15d43566184635b6674bc942"
 },
 {
  "address": "0x79e70d139fc05aa75f75611fdf2680e9952b544a",
  "chain": "ethereum",
  "section": "reported",
  "roleText": "Reported ETH stash address",
  "reportedRoleText": "ETH consolidation / stash wallet",
  "reportedSnapshotText": "34,279.6949 ETH (trace); Bitquery shortened (`0x79e7\u2026544a`) at 34,280 ETH",
  "anchor": false,
  "caseSection": "1. Ethereum",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a71 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x79e70d139fc05aa75f75611fdf2680e9952b544a"
 },
 {
  "address": "0xc2096a12ebe0944f4d39e59979f485afd92d850a",
  "chain": "ethereum",
  "section": "reported",
  "roleText": "Reported ETH stash address",
  "reportedRoleText": "ETH consolidation / stash wallet",
  "reportedSnapshotText": "5,815.9571 ETH (trace); Bitquery shortened (`0xc209\u2026850a`) at 7,003 ETH (later snapshot, Oct 31 16:51 UTC)",
  "anchor": false,
  "caseSection": "1. Ethereum",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a71 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xc2096a12ebe0944f4d39e59979f485afd92d850a"
 },
 {
  "address": "0x8d4b8ee62124b7ee140a51ddd07390a56f1c9e19",
  "chain": "ethereum",
  "section": "reported",
  "roleText": "Reported ETH consolidation wallet",
  "reportedRoleText": "ETH consolidation wallet",
  "reportedSnapshotText": "3,236.7175 ETH",
  "anchor": false,
  "caseSection": "1. Ethereum",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a71 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x8d4b8ee62124b7ee140a51ddd07390a56f1c9e19"
 },
 {
  "address": "0x15104a9ce0f08a8f0075a0869ae80e795fe0feb7",
  "chain": "ethereum",
  "section": "reported",
  "roleText": "Reported commingling wallet (per ZachXBT) \u2014 reported as linking Binance and Bitget flows inside the same incident window",
  "reportedRoleText": "Commingling wallet \u2014 received proceeds of BOTH the Binance and the September 2026 Bitget exploits after routing through THORChain; ZachXBT's basis for linking the two thefts to the same actor (Elliptic, citing ZachXBT: ~$39K of Binance funds)",
  "reportedSnapshotText": "0.0024 ETH; active dust redistribution (trace)",
  "anchor": false,
  "caseSection": "1. Ethereum",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a71 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x15104a9ce0f08a8f0075a0869ae80e795fe0feb7"
 },
 {
  "address": "0x3e2bf1ac6bf0934bbba6456c341c2ecbced632d5",
  "chain": "arbitrum",
  "section": "reported",
  "roleText": "Reported Arbitrum address \u2014 the Arbitrum Security Council froze and moved 8,426 ETH + 74,559,805 ARB (approximately $30.5M) out of it into an intermediary frozen wallet (Oct 30, ~00:08\u201300:18 UTC)",
  "reportedRoleText": "Attacker's Arbitrum address",
  "reportedSnapshotText": "Arbitrum Security Council froze and moved 8,426 ETH + 74,559,805 ARB (\u2248$30.5M) out of it into an intermediary frozen wallet, Oct 30 ~00:08\u201300:18 UTC",
  "anchor": true,
  "caseSection": "2. Arbitrum",
  "sourceLinks": [
   {
    "sourceKey": "zachxbt_disruption",
    "locator": "Case file \u00a72"
   },
   {
    "sourceKey": "oak",
    "locator": "Case file \u00a72"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x3E2Bf1Ac6Bf0934bbBA6456c341c2ecbCED632D5"
 },
 {
  "address": "bc1q0mtc2f5agpkvlq6hhahmfr3hlr55kyfjhl2mnm",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Peel root \u2014 reported as receiving 18,270.2 BTC from the Binance BTC hot wallet and splitting it into 19 outputs",
  "reportedRoleText": "Peel root \u2014 received 18,270.2 BTC from Binance's hot wallet and spent it onward into the 19 outputs below; not itself a holding address anymore",
  "reportedSnapshotText": "Received 18,270.2 BTC from the Binance BTC hot wallet and split it into 19 outputs (trace); not itself a holding address anymore",
  "anchor": false,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1q0mtc2f5agpkvlq6hhahmfr3hlr55kyfjhl2mnm"
 },
 {
  "address": "bc1qm2j6v3247khlwzxl7p9vqnfkghcllyhv9wjaat",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qm2j6v3247khlwzxl7p9vqnfkghcllyhv9wjaat"
 },
 {
  "address": "bc1qxrxujwxfnvz040jw76d26zhjdg5jura7hs968s",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qxrxujwxfnvz040jw76d26zhjdg5jura7hs968s"
 },
 {
  "address": "bc1qepc70u3u476vgvg3hfcwjgu4mecxe2uchs4lag",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qepc70u3u476vgvg3hfcwjgu4mecxe2uchs4lag"
 },
 {
  "address": "bc1qdfhmlrdvg4tm87zjl0vyf0xflp5ql50q3g88gw",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qdfhmlrdvg4tm87zjl0vyf0xflp5ql50q3g88gw"
 },
 {
  "address": "bc1qnq6jj9jmlf3945m3l8s0kxnqehrsga300k8t3s",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qnq6jj9jmlf3945m3l8s0kxnqehrsga300k8t3s"
 },
 {
  "address": "bc1q42flhayrzy3zh8lkyevw8qcjduurt9a35wlsyx",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1q42flhayrzy3zh8lkyevw8qcjduurt9a35wlsyx"
 },
 {
  "address": "bc1qz8hdwv8gmml0u96dsvnzsagz6krjyzxmgxupdp",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qz8hdwv8gmml0u96dsvnzsagz6krjyzxmgxupdp"
 },
 {
  "address": "bc1q0ts8gaf9ht0rr4u02hr56f8thndqsc4kmkmfv3",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1q0ts8gaf9ht0rr4u02hr56f8thndqsc4kmkmfv3"
 },
 {
  "address": "bc1q2wvz0kcsn4hqmajwtey30ud27fl25w8pveznn6",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1q2wvz0kcsn4hqmajwtey30ud27fl25w8pveznn6"
 },
 {
  "address": "bc1qalwnl7dtaa73fsq5tyn0ghfy3fgfpqkt69tca8",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qalwnl7dtaa73fsq5tyn0ghfy3fgfpqkt69tca8"
 },
 {
  "address": "bc1qjwdw6vrzq4vf6hckutvx4ucj86awwv99mxnz7w",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qjwdw6vrzq4vf6hckutvx4ucj86awwv99mxnz7w"
 },
 {
  "address": "bc1qs3aej5tmcdz0vctz8y9rjcxtxg8v5385577s56",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qs3aej5tmcdz0vctz8y9rjcxtxg8v5385577s56"
 },
 {
  "address": "bc1q63qrfrpsg5hh0zzn3kp2xx9vljl7dq7tatsjxp",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1q63qrfrpsg5hh0zzn3kp2xx9vljl7dq7tatsjxp"
 },
 {
  "address": "bc1qs6xnmhar38z44g2za93pv8ygdcwurrh8l87w3v",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qs6xnmhar38z44g2za93pv8ygdcwurrh8l87w3v"
 },
 {
  "address": "bc1qg3nrzpuvq2pxqx74tcrywr09dc208ze96n3t53",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qg3nrzpuvq2pxqx74tcrywr09dc208ze96n3t53"
 },
 {
  "address": "bc1qf5cyvv9w50tx9xx9s3xwsne0z87wvjj9l8a35u",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qf5cyvv9w50tx9xx9s3xwsne0z87wvjj9l8a35u"
 },
 {
  "address": "bc1qm8v88m5fy6kuq9myva2eemwycxqd3e0zcrs2l8",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output (holding)",
  "reportedRoleText": "Peel output (holding)",
  "reportedSnapshotText": "One of 19 reported unspent peel outputs. The reported aggregate across all 19 outputs is 18,270.1999 BTC (trace); per-address balances were not individually printed in the sources",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qm8v88m5fy6kuq9myva2eemwycxqd3e0zcrs2l8"
 },
 {
  "address": "bc1qrg025e2pgx0rwya2kpgtj30972p64jt0hn6zyt",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output \u2014 832.4999 BTC (odd-lot output identified by the trace)",
  "reportedRoleText": "Peel output \u2014 832.4999 BTC (odd-lot output identified by the trace)",
  "reportedSnapshotText": "832.4999 BTC (odd-lot output identified by the trace)",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qrg025e2pgx0rwya2kpgtj30972p64jt0hn6zyt"
 },
 {
  "address": "bc1qxg0l4p6xc50zuv9cl5f0l0wmaxjpg8wcy7s9ra",
  "chain": "bitcoin",
  "section": "reported",
  "roleText": "Reported peel output \u2014 437.7000 BTC (odd-lot output identified by the trace)",
  "reportedRoleText": "Peel output \u2014 437.7000 BTC (odd-lot output identified by the trace)",
  "reportedSnapshotText": "437.7000 BTC (odd-lot output identified by the trace)",
  "anchor": true,
  "caseSection": "4. Bitcoin",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a74 table (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qxg0l4p6xc50zuv9cl5f0l0wmaxjpg8wcy7s9ra"
 },
 {
  "address": "TPBkSjkCMn2ckrMuAP8n2J1jdjbw76bKN4",
  "chain": "tron",
  "section": "reported",
  "roleText": "First reported Tron wallet in the reported flow \u2014 reported as receiving the USDT forwarded out of a Binance-side wallet, then passing it on within about a minute",
  "reportedRoleText": "First attacker Tron wallet \u2014 received the USDT forwarded out of Binance's Tron hot wallet (100M USDT at 20:25:51 UTC Oct 29, then 200M at 20:36:09); also the hop wallet that passed 638.2M TRX to the collector",
  "reportedSnapshotText": "Created 20:24:54 UTC Oct 29; at trace time 0 USDT / 9.1 TRX",
  "anchor": false,
  "caseSection": "5. Tron",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a75 table (trace)"
   }
  ],
  "frozenState": null,
  "displayAddress": "TPBkSjkCMn2ckrMuAP8n2J1jdjbw76bKN4"
 },
 {
  "address": "TSpe5HC3PRD2svJcr1YoGszhHk2mtkyZ8A",
  "chain": "tron",
  "section": "reported",
  "roleText": "Reported TRX collector \u2014 reported as taking 638.2M TRX from the hop wallet, then splitting it on Oct 30 (10:15\u201310:20 UTC) into five fresh wallets",
  "reportedRoleText": "TRX collector \u2014 took 638.2M TRX from the hop wallet, then split it Oct 30 10:15\u201310:20 UTC into five fresh wallets (four of 120M TRX, one of 158.2M TRX)",
  "reportedSnapshotText": "Split on Oct 30, 10:15\u201310:20 UTC into five fresh wallets (four of 120M TRX, one of 158.2M TRX)",
  "anchor": false,
  "caseSection": "5. Tron",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a75 table (trace)"
   }
  ],
  "frozenState": null,
  "displayAddress": "TSpe5HC3PRD2svJcr1YoGszhHk2mtkyZ8A"
 },
 {
  "address": "TKkH2vH6kyi2QKcMbqym53WMuvdd1xvw6K",
  "chain": "tron",
  "section": "reported",
  "roleText": "Reported TRX stash wallet (the 158.2M TRX split output) \u2014 reported as never having sent a transaction",
  "reportedRoleText": "TRX stash wallet (the 158.2M TRX split output)",
  "reportedSnapshotText": "158.2M TRX; new at 10:20 UTC Oct 30; never sent a transaction (Bitquery, Oct 31 16:51 UTC)",
  "anchor": true,
  "caseSection": "5. Tron",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a75 table (trace)"
   }
  ],
  "frozenState": null,
  "displayAddress": "TKkH2vH6kyi2QKcMbqym53WMuvdd1xvw6K"
 },
 {
  "address": "TRBdWqHnDVSZCVGfgHdKFLQPirQcA2PRki",
  "chain": "tron",
  "section": "reported",
  "roleText": "Reported TRX payout wallet \u2014 reported as paying TRX out in small lots to exchanges and services",
  "reportedRoleText": "TRX payout wallet \u2014 pays TRX out in small lots to SunSwap, THORChain and Relay; sent 427M TRX to 171 addresses Oct 30\u201331 (Bitquery)",
  "reportedSnapshotText": "69.6M TRX at Bitquery's Oct 31 snapshot",
  "anchor": false,
  "caseSection": "5. Tron",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a75 table (trace)"
   }
  ],
  "frozenState": null,
  "displayAddress": "TRBdWqHnDVSZCVGfgHdKFLQPirQcA2PRki"
 },
 {
  "address": "TSUUVjysXV8YqHytSNjfkNXnnB49QDvZpx",
  "chain": "tron",
  "section": "reported",
  "roleText": "Reported downstream hop in the reported Tron flow",
  "reportedRoleText": "Downstream hop",
  "reportedSnapshotText": "78,880.87 USDT + 83,852.33 TRX at trace time. Not in Elliptic's blocklist per the trace",
  "anchor": false,
  "caseSection": "5. Tron",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a75 table (trace)"
   }
  ],
  "frozenState": null,
  "displayAddress": "TSUUVjysXV8YqHytSNjfkNXnnB49QDvZpx"
 },
 {
  "address": "TVjuTE3V5bMVdpfNhid8kD2v35T2k1u1Br",
  "chain": "tron",
  "section": "reported",
  "roleText": "Reported downstream hop in the reported Tron flow",
  "reportedRoleText": "Downstream hop",
  "reportedSnapshotText": "260,260.37 TRX at trace time. Not in Elliptic's blocklist per the trace",
  "anchor": false,
  "caseSection": "5. Tron",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a75 table (trace)"
   }
  ],
  "frozenState": null,
  "displayAddress": "TVjuTE3V5bMVdpfNhid8kD2v35T2k1u1Br"
 },
 {
  "address": "TCBAz7itvtX5CjBzVMPQdrbwQLN63ao1fk",
  "chain": "tron",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": "In Bitquery's published record list; role not specified in its narrative",
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "5. Tron",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a75 / \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "TCBAz7itvtX5CjBzVMPQdrbwQLN63ao1fk"
 },
 {
  "address": "TJajtPqDqUGh1Sr1j8ugHoSXBVpaFLLHKT",
  "chain": "tron",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": "In Bitquery's published record list; role not specified in its narrative",
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "5. Tron",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a75 / \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "TJajtPqDqUGh1Sr1j8ugHoSXBVpaFLLHKT"
 },
 {
  "address": "TMDENHFSiRzmJNSEBAFmrDbLkQ672iPN8H",
  "chain": "tron",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": "In Bitquery's published record list; role not specified in its narrative",
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "5. Tron",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a75 / \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "TMDENHFSiRzmJNSEBAFmrDbLkQ672iPN8H"
 },
 {
  "address": "TNhpfKq83wufEKGjBhQFnT7jnxYmyBzH6F",
  "chain": "tron",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": "In Bitquery's published record list; role not specified in its narrative",
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "5. Tron",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a75 / \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "TNhpfKq83wufEKGjBhQFnT7jnxYmyBzH6F"
 },
 {
  "address": "rK21t6nGLy4MNDqhvy3pGwcLFy25qgfzMx",
  "chain": "xrp_ledger",
  "section": "reported",
  "roleText": "Reported XRP account in the reported flow",
  "reportedRoleText": "Attacker's XRP account \u2014 five Binance accounts sent 233.5M XRP to it (Bitquery); trace-verified balance 233,461,943.10005 XRP; never sent a transaction",
  "reportedSnapshotText": "233,461,943.10005 XRP (trace-verified balance); never sent a transaction",
  "anchor": true,
  "caseSection": "6. XRP Ledger and Solana",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a76 \u2014 full form in Bitquery record list"
   },
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a76 (trace-verified balance)"
   }
  ],
  "frozenState": null,
  "displayAddress": "rK21t6nGLy4MNDqhvy3pGwcLFy25qgfzMx"
 },
 {
  "address": "AffzFDKZbyMiU11zmVBoAqD25ugpr7xoWWyRyGigBEaU",
  "chain": "solana",
  "section": "reported",
  "roleText": "Main reported Solana wallet in the reported flow",
  "reportedRoleText": "Main Solana attacker wallet \u2014 970.554124500363 SOL, active (Bitquery's table: 970,554 SOL, never sent a transaction)",
  "reportedSnapshotText": "970.554124500363 SOL, active (yoursAudit trace). Bitquery's table reported 970,554 SOL and \"never sent a transaction\" \u2014 the two snapshots differ by source and are preserved separately",
  "anchor": false,
  "caseSection": "6. XRP Ledger and Solana",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a76 (trace)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "AffzFDKZbyMiU11zmVBoAqD25ugpr7xoWWyRyGigBEaU"
 },
 {
  "address": "9SkjwUs5pRRQQo5a6g4m5cciy1xLdDeFnaov24htTjdQ",
  "chain": "solana",
  "section": "reported",
  "roleText": "Second reported Solana address in the reported flow",
  "reportedRoleText": "Second Solana address \u2014 0.00148844 SOL; 3 signatures, all Oct 29 from 20:43:14 UTC",
  "reportedSnapshotText": "0.00148844 SOL; 3 signatures, all Oct 29 from 20:43:14 UTC",
  "anchor": false,
  "caseSection": "6. XRP Ledger and Solana",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a76 (trace)"
   }
  ],
  "frozenState": null,
  "displayAddress": "9SkjwUs5pRRQQo5a6g4m5cciy1xLdDeFnaov24htTjdQ"
 },
 {
  "address": "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
  "chain": "solana",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": "In Bitquery's published record list; role not specified in its narrative (the trace's count of Elliptic's file lists 3 Solana/Sui addresses total)",
  "reportedSnapshotText": "Bitquery record list",
  "anchor": false,
  "caseSection": "6. XRP Ledger and Solana",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a76 / \u00a711 \u2014 Bitquery record list"
   }
  ],
  "frozenState": null,
  "displayAddress": "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"
 },
 {
  "address": "0x28c6c06298d514db089934071355e5743bf21d60",
  "chain": "ethereum",
  "section": "victim_owned",
  "roleText": "\"Binance 14\" \u2014 a Binance-owned hot wallet (identified in the sources)",
  "reportedRoleText": "\"Binance 14\" \u2014 Binance hot wallet taken over via the EIP-7702 delegation; delegation revoked by Binance at 00:10 UTC Oct 30",
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "8. Victim (Binance-owned) addresses",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a78 (trace identification)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a78 / \u00a711"
   },
   {
    "sourceKey": "oak",
    "locator": "Case file \u00a78"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x28c6c06298d514db089934071355e5743bf21d60"
 },
 {
  "address": "0xdfd5293d8e347dfe59e90efd55b2956a1343963d",
  "chain": "ethereum",
  "section": "victim_owned",
  "roleText": "\"Binance 16\" \u2014 a Binance-owned wallet (identified in the sources)",
  "reportedRoleText": "\"Binance 16\" \u2014 Binance wallet that sent 28,005.6 ETH to drain1 by ordinary signed transfer",
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "8. Victim (Binance-owned) addresses",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a78 (trace identification)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a78 / \u00a711"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xdfd5293d8e347dfe59e90efd55b2956a1343963d"
 },
 {
  "address": "0xee7ae85f2fe2239e27d9c1e23fffe168d63b4055",
  "chain": "ethereum",
  "section": "victim_owned",
  "roleText": "\"Hot Wallet 34\" \u2014 a Binance-owned smart wallet (identified in the sources)",
  "reportedRoleText": "\"Hot Wallet 34\" \u2014 Binance smart wallet that obeys Binance 14; 823M USDC was pulled through the delegated EOA's admin rights (reported by Tibane/Blockscout per the trace)",
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "8. Victim (Binance-owned) addresses",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a78 (trace identification)"
   },
   {
    "sourceKey": "oak",
    "locator": "Case file \u00a78"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xee7ae85f2fe2239e27d9c1e23fffe168d63b4055"
 },
 {
  "address": "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
  "chain": "bitcoin",
  "section": "victim_owned",
  "roleText": "Binance-owned BTC hot wallet (identified in the sources)",
  "reportedRoleText": "Binance BTC hot wallet \u2014 source of the 18,270.2 BTC peel",
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "8. Victim (Binance-owned) addresses",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a78 (trace identification)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a78 / \u00a711"
   }
  ],
  "frozenState": null,
  "displayAddress": "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h"
 },
 {
  "address": "TG5iBMQPrDzJJAUM8GMVBf1hRaJ1wvzsGi",
  "chain": "tron",
  "section": "victim_owned",
  "roleText": "Binance-owned Tron hot wallet (identified in the sources)",
  "reportedRoleText": "Binance Tron hot wallet \u2014 forwarded 100M + 200M USDT to the attacker's first Tron wallet under the compromised signing path",
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "8. Victim (Binance-owned) addresses",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a78 (trace identification)"
   }
  ],
  "frozenState": null,
  "displayAddress": "TG5iBMQPrDzJJAUM8GMVBf1hRaJ1wvzsGi"
 },
 {
  "address": "TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf",
  "chain": "tron",
  "section": "victim_owned",
  "roleText": "Binance-side funding wallet (per the reported flow in the sources)",
  "reportedRoleText": "Sent 612,729,468 USDT to Binance's Tron hot wallet at 20:22:45 UTC Oct 29, minutes before the outflows (per the trace's transaction list) \u2014 consistent with a Binance-side funding wallet; included in Bitquery's record list. Role beyond that flow is not stated in the sources",
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "8. Victim (Binance-owned) addresses",
  "sourceLinks": [
   {
    "sourceKey": "yoursaudit",
    "locator": "Case file \u00a78 (trace identification)"
   },
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a78 / \u00a711"
   }
  ],
  "frozenState": null,
  "displayAddress": "TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf"
 },
 {
  "address": "0x2a828d0b500d93abf98f135fa5d750634c062029",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": "Identified in Bitquery's narrative as a THORChain payee (3,600 ETH received from THORChain swaps)",
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x2a828d0b500d93abf98f135fa5d750634c062029"
 },
 {
  "address": "0xfbb9b74615895adc609e180eb823dcdefcb50446",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xfbb9b74615895adc609e180eb823dcdefcb50446"
 },
 {
  "address": "0xeb642aa36b0f002f99c737969c82986cc68c223f",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xeb642aa36b0f002f99c737969c82986cc68c223f"
 },
 {
  "address": "0xb3eb1e1e04d5b8549d444e55f518b54299eaad15",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xb3eb1e1e04d5b8549d444e55f518b54299eaad15"
 },
 {
  "address": "0xea700e5105a6cd668421d393494eee2eda2be4a3",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xea700e5105a6cd668421d393494eee2eda2be4a3"
 },
 {
  "address": "0x9e15934815ba7e2288e32cdea3c42dfef1b6c898",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x9e15934815ba7e2288e32cdea3c42dfef1b6c898"
 },
 {
  "address": "0x5cd4e1b9e6d2b21b31920627ad136c2ec562cc84",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x5cd4e1b9e6d2b21b31920627ad136c2ec562cc84"
 },
 {
  "address": "0xe7d8da5334faca0d3468aca2b4d7fe3d7371033f",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xe7d8da5334faca0d3468aca2b4d7fe3d7371033f"
 },
 {
  "address": "0x2496ed11170c00b222b8d71750efa68a659a9c89",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x2496ed11170c00b222b8d71750efa68a659a9c89"
 },
 {
  "address": "0x9ebe5208bbe6d4cc5c650d215f664ec398f77620",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x9ebe5208bbe6d4cc5c650d215f664ec398f77620"
 },
 {
  "address": "0xbc421e32c89cc4bc2e74112a789c3b1274944e34",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xbc421e32c89cc4bc2e74112a789c3b1274944e34"
 },
 {
  "address": "0xc5989e405a3c5c7fd6004031b5f8720048ebea83",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xc5989e405a3c5c7fd6004031b5f8720048ebea83"
 },
 {
  "address": "0xcb2bbb34adda1a129c7da484bc7e146317ccc9b1",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xcb2bbb34adda1a129c7da484bc7e146317ccc9b1"
 },
 {
  "address": "0x46b71b5a7fca75df854bc0df050196acc1b2e3cb",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x46b71b5a7fca75df854bc0df050196acc1b2e3cb"
 },
 {
  "address": "0x7730ba504119352ca443966fbeb45df58bf60652",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x7730ba504119352ca443966fbeb45df58bf60652"
 },
 {
  "address": "0xd1043182c9c4491ce05c3c0f2d4c87d2438bbd2b",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xd1043182c9c4491ce05c3c0f2d4c87d2438bbd2b"
 },
 {
  "address": "0xabc9bc99b32c8a181777482bec4641149c59ed74",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xabc9bc99b32c8a181777482bec4641149c59ed74"
 },
 {
  "address": "0xb53d4bbc4037ba645a1de2ba21d7625f4f700961",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xb53d4bbc4037ba645a1de2ba21d7625f4f700961"
 },
 {
  "address": "0xde530e399782dccba0b3b90d4107d1995abf1876",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xde530e399782dccba0b3b90d4107d1995abf1876"
 },
 {
  "address": "0x3c8bc1f4e66a5981f910a78db6d0840908e1fd38",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x3c8bc1f4e66a5981f910a78db6d0840908e1fd38"
 },
 {
  "address": "0x13157adc3543d5ca645d8f8fc7a505155372e567",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x13157adc3543d5ca645d8f8fc7a505155372e567"
 },
 {
  "address": "0xcdcd7ed935c5a229033c075474b4522f54678800",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xcdcd7ed935c5a229033c075474b4522f54678800"
 },
 {
  "address": "0xdfdf533417545b32bae2aa25bf8d87fea5d99929",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xdfdf533417545b32bae2aa25bf8d87fea5d99929"
 },
 {
  "address": "0x7d4c8bf487d373719007b7b6fa93f953ac5be32b",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x7d4c8bf487d373719007b7b6fa93f953ac5be32b"
 },
 {
  "address": "0x2a997f582d0d52b779e663f972c453267dc5a3a5",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x2a997f582d0d52b779e663f972c453267dc5a3a5"
 },
 {
  "address": "0x0c65c40ef939f689c8d59e7c3df3993b7a905cd4",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x0c65c40ef939f689c8d59e7c3df3993b7a905cd4"
 },
 {
  "address": "0x0f6a46ecbe0d22176502fc43b56cc1eeb0952aaf",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x0f6a46ecbe0d22176502fc43b56cc1eeb0952aaf"
 },
 {
  "address": "0x6e400e716c8627a64610cdf75b71971c60b989a7",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x6e400e716c8627a64610cdf75b71971c60b989a7"
 },
 {
  "address": "0xb9b3e2d1001fbb1a677cdee8fcb628a705bf14c8",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xb9b3e2d1001fbb1a677cdee8fcb628a705bf14c8"
 },
 {
  "address": "0x42f8104020ccf1b0eaee18cddd01d6d3b10aa71c",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x42f8104020ccf1b0eaee18cddd01d6d3b10aa71c"
 },
 {
  "address": "0xf0ded6a1fe1a1619a495f86c6c7d1dd1e27ea116",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xf0ded6a1fe1a1619a495f86c6c7d1dd1e27ea116"
 },
 {
  "address": "0xb416897fa621079af44323f09804ee073c296ed3",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xb416897fa621079af44323f09804ee073c296ed3"
 },
 {
  "address": "0x556e6f6a6f8160cb7a9c60cef7955c1cd5f36c70",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x556e6f6a6f8160cb7a9c60cef7955c1cd5f36c70"
 },
 {
  "address": "0x7680e63171d3fc2f56dea5c6695829d6f0031d1a",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x7680e63171d3fc2f56dea5c6695829d6f0031d1a"
 },
 {
  "address": "0x437c109630b58589a5e357e64f03b86709e71f6f",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x437c109630b58589a5e357e64f03b86709e71f6f"
 },
 {
  "address": "0x03173d894962459483e477cd9a04777bb3a0d8d8",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x03173d894962459483e477cd9a04777bb3a0d8d8"
 },
 {
  "address": "0xabb613302ba958abf07a6d9fdde911cf0c89660c",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch A)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xabb613302ba958abf07a6d9fdde911cf0c89660c"
 },
 {
  "address": "0x9a3dbf99edd0c063171d61130d82f1e6edd7cb409af5e7f2f95acd89e9584d8a",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x9a3dbf99edd0c063171d61130d82f1e6edd7cb409af5e7f2f95acd89e9584d8a"
 },
 {
  "address": "0x87dc21e529a8baa4f2cb8a0e18f2b6b37c1993ec",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x87dc21e529a8baa4f2cb8a0e18f2b6b37c1993ec"
 },
 {
  "address": "0x859d96a9a37d5b41e87fef0d7e69382a5a98fbfc",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x859d96a9a37d5b41e87fef0d7e69382a5a98fbfc"
 },
 {
  "address": "0x37174683f0c23a0a1c97a26621a6f0a3753b80bf",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x37174683f0c23a0a1c97a26621a6f0a3753b80bf"
 },
 {
  "address": "0x28fa12779c47a1354b59c98bac3c96fa6c7b48bf",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x28fa12779c47a1354b59c98bac3c96fa6c7b48bf"
 },
 {
  "address": "0x576d88620eba7c4629145765c6eab03f1603ac9e",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x576d88620eba7c4629145765c6eab03f1603ac9e"
 },
 {
  "address": "0x2a9f257b2be6e695121c9867008458db0c8d4682",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x2a9f257b2be6e695121c9867008458db0c8d4682"
 },
 {
  "address": "0x4a1ef7232c9a77c8c5df55a72804f7c58bbbd4c6",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x4a1ef7232c9a77c8c5df55a72804f7c58bbbd4c6"
 },
 {
  "address": "0x5c5ba663fe3773ded4b8b51637d7cf20b38dbeb4",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x5c5ba663fe3773ded4b8b51637d7cf20b38dbeb4"
 },
 {
  "address": "0x9accd7fb58c766024293862f3629924b55e316e4",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x9accd7fb58c766024293862f3629924b55e316e4"
 },
 {
  "address": "0x203eea6e7f252dd4c017677b155fca86dce3c498",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x203eea6e7f252dd4c017677b155fca86dce3c498"
 },
 {
  "address": "0xd6da07a7fd683644a309c27beec42c0705310320",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xd6da07a7fd683644a309c27beec42c0705310320"
 },
 {
  "address": "0x3d1feccebbd13e5c46fa79c8502f4ed79c2fddbb",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x3d1feccebbd13e5c46fa79c8502f4ed79c2fddbb"
 },
 {
  "address": "0xded2cda38997601b23b9653aec3571879e993cce",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xded2cda38997601b23b9653aec3571879e993cce"
 },
 {
  "address": "0x98494fe2693a75a701e0a342d5e509c2b3f9eb1d",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x98494fe2693a75a701e0a342d5e509c2b3f9eb1d"
 },
 {
  "address": "0x50a736abc060f8d4b4717f8b0f8e9e6bdb3fc6a3",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x50a736abc060f8d4b4717f8b0f8e9e6bdb3fc6a3"
 },
 {
  "address": "0xa299d7e7975f212d4dd7b1553e0718a8627e4ce7",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xa299d7e7975f212d4dd7b1553e0718a8627e4ce7"
 },
 {
  "address": "0xe6d3364d68ed1396e6fad5598dad05edf95dbcbb",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xe6d3364d68ed1396e6fad5598dad05edf95dbcbb"
 },
 {
  "address": "0xb2a7c0a997dd8a617d5c259acb42ec4344d49421",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xb2a7c0a997dd8a617d5c259acb42ec4344d49421"
 },
 {
  "address": "0x680c4a536df63650df5711d728aaf2c99dd4f96f",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x680c4a536df63650df5711d728aaf2c99dd4f96f"
 },
 {
  "address": "0xdd5367098352990e3e263e9e519af16b709dfe25",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xdd5367098352990e3e263e9e519af16b709dfe25"
 },
 {
  "address": "0x69fad82c8e46f6f8d507f7329850cc8d0920b403",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x69fad82c8e46f6f8d507f7329850cc8d0920b403"
 },
 {
  "address": "0xdd159280b72a9528cc8f0fbeda46f4a8263c12d4",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xdd159280b72a9528cc8f0fbeda46f4a8263c12d4"
 },
 {
  "address": "0x3fc5bfb57f2ba93e12d1e3e7912c5b993778c63a",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x3fc5bfb57f2ba93e12d1e3e7912c5b993778c63a"
 },
 {
  "address": "0x4c1bef3367535cfdf05f73e23ed6ee3907103e48",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x4c1bef3367535cfdf05f73e23ed6ee3907103e48"
 },
 {
  "address": "0xc58623b61dfb8e3e583b43613bf2c1c025fde935",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xc58623b61dfb8e3e583b43613bf2c1c025fde935"
 },
 {
  "address": "0xfb34f34a0a395afb3d5094816aa235483f0c2095",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xfb34f34a0a395afb3d5094816aa235483f0c2095"
 },
 {
  "address": "0x09c9bdb15c8ce62cc875de32f6a48a419e389dd6",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x09c9bdb15c8ce62cc875de32f6a48a419e389dd6"
 },
 {
  "address": "0xa3e1a5b5ec04907932101962a2fbec614b1cbb04",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xa3e1a5b5ec04907932101962a2fbec614b1cbb04"
 },
 {
  "address": "0x73ee90554fd0954490b072ca11e6422642ab4593",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x73ee90554fd0954490b072ca11e6422642ab4593"
 },
 {
  "address": "0x11861b31b97c5c6550d49b03b1eed1a105774084",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x11861b31b97c5c6550d49b03b1eed1a105774084"
 },
 {
  "address": "0x6b1bae59d09fccbddb6c6cceb07b7279367c4e3b",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Batch B)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0x6b1bae59d09fccbddb6c6cceb07b7279367c4e3b"
 },
 {
  "address": "0xe4f9070e1316de2988fc6f869fead8fb99cc74cd",
  "chain": "ethereum",
  "section": "reported",
  "roleText": null,
  "reportedRoleText": null,
  "reportedSnapshotText": null,
  "anchor": false,
  "caseSection": "3. Ethereum \u2014 Bitquery record list (Further EVM records)",
  "sourceLinks": [
   {
    "sourceKey": "bitquery",
    "locator": "Case file \u00a711 \u2014 \"The record\" (Bitquery record list, Oct 31, 2026)"
   }
  ],
  "frozenState": null,
  "displayAddress": "0xe4f9070e1316de2988fc6f869fead8fb99cc74cd"
 }
];
