// Stolen-Funds Watch feature flags (spec §12.2). Every flag defaults OFF.
// Building and deploying this feature is NOT launching it: the public page,
// the monitor, alert delivery and the packet builder each stay dark until
// their own environment flag is explicitly enabled AND the per-case switch
// stored on watch_cases is on. Nothing in this module ever turns a flag on.

export function envFlag(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export const watchFlags = {
  publicEnabled: () => envFlag("WATCH_PUBLIC_ENABLED"),
  monitorEnabled: () => envFlag("WATCH_MONITOR_ENABLED"),
  alertsEnabled: () => envFlag("WATCH_ALERTS_ENABLED"),
  packetEnabled: () => envFlag("WATCH_PACKET_ENABLED"),
  importEnabled: () => envFlag("WATCH_IMPORT_ENABLED"),
};

export interface WatchCaseSwitches {
  publicEnabled: boolean;
  monitoringEnabled: boolean;
  alertsEnabled: boolean;
}

export function effectivePublic(c: WatchCaseSwitches): boolean {
  return watchFlags.publicEnabled() && c.publicEnabled;
}
export function effectiveMonitor(c: WatchCaseSwitches): boolean {
  return watchFlags.monitorEnabled() && c.monitoringEnabled;
}
export function effectiveAlerts(c: WatchCaseSwitches): boolean {
  return watchFlags.alertsEnabled() && c.alertsEnabled;
}
