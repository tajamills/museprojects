import { useEffect, useState } from "react";
import { fetchMe, type MeInfo } from "./api";

/**
 * Current sign-in state. `undefined` while the first /api/me request is in
 * flight (render nothing auth-dependent yet); afterwards a MeInfo.
 */
export function useMe(): MeInfo | undefined {
  const [me, setMe] = useState<MeInfo | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetchMe().then((info) => {
      if (live) setMe(info);
    });
    return () => {
      live = false;
    };
  }, []);
  return me;
}
