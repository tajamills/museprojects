import { useEffect, useState } from "react";
import { fetchMe, type MeInfo } from "./api";

/**
 * Current sign-in state, shared by every component on the page.
 *
 * One module-level snapshot and one in-flight /api/me request serve all
 * useMe() callers (header account, book page, reader, unlock buttons),
 * so the whole page resolves its identity at the same moment instead of
 * each component racing its own fetch and painting its own interim
 * state. The snapshot is `undefined` while the first request is in
 * flight; consumers must render a NEUTRAL state until it resolves —
 * never the signed-out state, which is how owned books used to flash
 * (or stick) as "Locked" with a buy button after sign-in.
 */
let snapshot: MeInfo | undefined;
let inflight: Promise<void> | null = null;
const listeners = new Set<(info: MeInfo) => void>();

function publish(info: MeInfo): void {
  snapshot = info;
  for (const listener of listeners) listener(info);
}

function loadMe(force: boolean): void {
  if (!force && (inflight !== null || snapshot !== undefined)) return;
  const request = fetchMe().then((info) => {
    // A forced reload may have superseded this request; only the
    // latest one gets to publish.
    if (inflight === request) {
      inflight = null;
      publish(info);
    }
  });
  inflight = request;
}

/** Force a fresh /api/me read and publish it when it lands. */
export function refreshMe(): void {
  loadMe(true);
}

/**
 * Seed the snapshot with an identity the server just confirmed — the
 * sign-in / sign-up responses carry the same payload as /api/me.
 */
export function setMe(info: MeInfo): void {
  inflight = null;
  publish(info);
}

/**
 * Forget the identity entirely (sign-out), so the next sign-in starts
 * clean instead of inheriting the previous account's snapshot.
 * Listeners are not notified: sign-out is always followed by a full
 * navigation, and publishing a guessed "signed out" snapshot here
 * would be wrong if the server call had actually failed.
 */
export function clearMe(): void {
  inflight = null;
  snapshot = undefined;
}

export function useMe(): MeInfo | undefined {
  const [me, setMeState] = useState<MeInfo | undefined>(() => snapshot);
  useEffect(() => {
    const listener = (info: MeInfo) => setMeState(info);
    listeners.add(listener);
    // Catch up with anything published between render and effect.
    if (snapshot !== undefined) setMeState(snapshot);
    loadMe(false);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return me;
}
