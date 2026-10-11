// Replacements for the two helpers the original client imported from
// "@hatch/space-sdk/client": fileToBase64 and SafeAreaTopScrim.
// Behavior is identical to the SDK's implementations.
import { createElement, type CSSProperties, type ReactNode } from "react";

/** Read a browser File/Blob into the { dataBase64, mimeType } shape the
 *  createPost action accepts. Chunked btoa encoding handles multi-megabyte
 *  phone photos without blowing the call stack. */
export async function fileToBase64(file: File | Blob): Promise<{ dataBase64: string; mimeType: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const native = bytes as Uint8Array & { toBase64?: () => string };
  let dataBase64: string;
  if (typeof native.toBase64 === "function") {
    dataBase64 = native.toBase64();
  } else {
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }
    dataBase64 = btoa(binary);
  }
  return { dataBase64, mimeType: file.type || "application/octet-stream" };
}

interface SafeAreaTopScrimProps {
  backgroundColor?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Thin fixed overlay that fills the top safe-area inset (notch/status bar).
 *  Matches the SDK component's default "gradient" look closely enough for
 *  the two places App.tsx uses it. */
export function SafeAreaTopScrim({ backgroundColor = "var(--bg)", className, style }: SafeAreaTopScrimProps) {
  const gradientMask = "linear-gradient(to bottom, black 55%, transparent 100%)";
  return createElement("div", {
    "aria-hidden": true,
    className,
    style: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 40,
      pointerEvents: "none",
      height: "calc(env(safe-area-inset-top, 0px) + 44px)",
      backgroundColor,
      maskImage: gradientMask,
      WebkitMaskImage: gradientMask,
      ...style,
    } satisfies CSSProperties,
  });
}
