// One hand-drawn icon family for Abisola Writes: 24x24 grid, 1.7 stroke,
// round caps/joins, and slightly uneven hand-set paths so the set reads as
// drawn by one hand. No stock emoji, no typed glyphs.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function base(props: P) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export function DoorIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M5.2 20.4 L5.5 9.2 C5.6 5.9 7.9 3.8 12.1 3.6 C16.2 3.8 18.5 6 18.6 9.3 L18.9 20.3" />
      <path d="M3.4 20.6 L20.7 20.2" />
      <path d="M9.1 20.2 L9.3 10.4 C9.4 8.2 10.4 6.9 12.1 6.8 C13.8 7 14.7 8.3 14.8 10.5 L15 20.1" />
      <circle cx="16.9" cy="13.6" r="0.4" fill="currentColor" />
    </svg>
  );
}

export function BookOpenIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M12 6.2 C10.2 4.7 7.4 4.2 4.3 4.7 L4.2 18.3 C7.3 17.8 10.1 18.3 11.9 19.7 L12 6.2 Z" />
      <path d="M12.1 6.2 C13.9 4.7 16.7 4.2 19.8 4.6 L19.9 18.2 C16.8 17.8 14 18.3 12.1 19.7 L12.1 6.2 Z" />
      <path d="M7 8.6 C8.4 8.3 9.7 8.5 10.8 9.1" />
      <path d="M7.1 12.2 C8.4 11.9 9.6 12.1 10.7 12.7" />
      <path d="M17 8.5 C15.7 8.2 14.4 8.4 13.3 9" />
    </svg>
  );
}

export function KeyIcon(props: P) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="14.6" r="4.4" />
      <path d="M11.3 11.4 L19.6 3.9" />
      <path d="M16.9 6.6 L19.3 9.1" />
      <path d="M14.4 9 L16.5 11.3" />
    </svg>
  );
}

export function LockIcon(props: P) {
  return (
    <svg {...base(props)}>
      <rect x="5.1" y="10.4" width="13.8" height="9.4" rx="2.4" />
      <path d="M8.3 10.3 L8.4 7.6 C8.5 5.2 9.9 3.7 12 3.7 C14.2 3.7 15.6 5.3 15.7 7.7 L15.7 10.3" />
      <circle cx="12" cy="14.6" r="1.5" />
      <path d="M12 15.9 L12 17.4" />
    </svg>
  );
}

export function UnlockIcon(props: P) {
  return (
    <svg {...base(props)}>
      <rect x="5.1" y="10.4" width="13.8" height="9.4" rx="2.4" />
      <path d="M8.3 10.3 L8.4 7.6 C8.5 5.2 9.9 3.7 12 3.7 C14 3.7 15.4 5.1 15.6 7.2" />
      <circle cx="12" cy="14.6" r="1.5" />
      <path d="M12 15.9 L12 17.4" />
    </svg>
  );
}

export function SparklesIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M11 4.1 C11.4 6.5 12.1 8 14.6 8.6 C12.2 9.1 11.4 10.6 11 13.1 C10.6 10.6 9.8 9.1 7.4 8.6 C9.9 8 10.6 6.5 11 4.1 Z" />
      <path d="M18.4 12.8 C18.6 14.3 19.1 15 20.5 15.4 C19.1 15.7 18.6 16.5 18.4 18 C18.1 16.5 17.6 15.7 16.2 15.4 C17.6 15 18.1 14.2 18.4 12.8 Z" />
      <path d="M5.9 15.2 C6.1 16.4 6.5 17 7.7 17.3 C6.5 17.6 6.1 18.2 5.9 19.4 C5.7 18.2 5.3 17.6 4.1 17.3 C5.3 17 5.7 16.4 5.9 15.2 Z" />
    </svg>
  );
}

export function FeatherIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M19.8 4.1 C14.5 4.3 8.9 7.6 6.9 13.3 C6.2 15.3 6.1 17.9 6.4 19.6 C8.2 19.8 10.7 19.5 12.7 18.7 C18.2 16.5 20 9.9 19.8 4.1 Z" />
      <path d="M6.5 19.5 C9.3 14.6 12.8 10.7 17.6 7.4" />
      <path d="M11.4 13.1 L15.6 13.3" />
    </svg>
  );
}

export function CalendarIcon(props: P) {
  return (
    <svg {...base(props)}>
      <rect x="3.8" y="5.4" width="16.5" height="15" rx="2.6" />
      <path d="M3.9 10 L20.2 9.8" />
      <path d="M8.1 3.4 L8.2 6.9" />
      <path d="M15.9 3.5 L16 7" />
      <circle cx="8.3" cy="13.8" r="0.5" fill="currentColor" />
      <circle cx="12.1" cy="13.7" r="0.5" fill="currentColor" />
      <circle cx="15.9" cy="13.9" r="0.5" fill="currentColor" />
    </svg>
  );
}

export function ClockIcon(props: P) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12.1" r="8.3" />
      <path d="M12 7.4 L12.1 12.2 L15.6 14.1" />
    </svg>
  );
}

export function VideoIcon(props: P) {
  return (
    <svg {...base(props)}>
      <rect x="3.4" y="6.6" width="12.6" height="11" rx="2.5" />
      <path d="M16.1 10.6 L20.4 7.9 L20.5 16.3 L16.1 13.7" />
    </svg>
  );
}

export function MailIcon(props: P) {
  return (
    <svg {...base(props)}>
      <rect x="3.3" y="5.6" width="17.4" height="12.9" rx="2.4" />
      <path d="M4 7.4 L12 13.4 L20 7.3" />
    </svg>
  );
}

export function ScrollIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M7 4.2 L16.8 4 C18.3 4 19.3 4.9 19.3 6.2 C19.3 7.4 18.4 8.2 17.1 8.2 L8.4 8.3" />
      <path d="M17 8.2 L17.1 17.8 C17.1 19.1 16.1 20 14.7 20 L7.2 20.1 C5.8 20.1 4.8 19.2 4.8 18 C4.8 16.8 5.7 16 6.9 16 L16.9 15.9" />
      <path d="M8.6 11.8 L14.4 11.7" />
      <path d="M8.6 14 L12.6 13.9" />
    </svg>
  );
}

export function LayersIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M12 4 L20.3 8.4 L12 12.9 L3.7 8.5 L12 4 Z" />
      <path d="M4.6 12.4 L12 16.4 L19.4 12.3" />
      <path d="M4.7 16 L12 19.9 L19.3 15.9" />
    </svg>
  );
}

export function ShieldIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.6 L18.9 5.9 L18.8 11.4 C18.7 16 15.9 18.9 12 20.5 C8.1 18.9 5.3 16.1 5.2 11.5 L5.1 6 L12 3.6 Z" />
      <path d="M9.1 11.7 L11.2 13.9 L15 9.7" />
    </svg>
  );
}

export function MusicIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M9.3 18.3 L9.2 7.2 L19.4 5.2 L19.5 15.9" />
      <circle cx="6.7" cy="18.3" r="2.6" />
      <circle cx="16.9" cy="15.9" r="2.6" />
    </svg>
  );
}

export function PlayIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M8 5.4 C11.5 7.3 14.8 9.4 17.7 11.9 C14.9 14.4 11.6 16.6 8.1 18.6 C7.9 14.2 7.9 9.8 8 5.4 Z" />
    </svg>
  );
}

export function DownloadIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M12 4 L12.1 14.2" />
      <path d="M7.2 10.4 L12 15.3 L16.9 10.3" />
      <path d="M4.6 19.6 L19.5 19.4" />
    </svg>
  );
}

export function SunIcon(props: P) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3.4 L12 5.2" />
      <path d="M12 18.9 L12 20.7" />
      <path d="M3.5 12 L5.3 12" />
      <path d="M18.8 12 L20.6 12" />
      <path d="M5.9 5.8 L7.2 7.1" />
      <path d="M16.9 16.9 L18.2 18.2" />
      <path d="M18.1 5.9 L16.8 7.2" />
      <path d="M7.1 16.9 L5.8 18.2" />
    </svg>
  );
}

export function MoonIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M19.6 15.4 C18.2 18.3 15.4 20.1 12.2 20 C8 19.9 4.8 16.6 4.8 12.3 C4.8 8.7 7.1 5.7 10.4 4.6 C9.7 6.2 9.5 7.7 9.8 9.3 C10.3 12.3 12.6 14.4 15.7 14.9 C17 15.1 18.3 15.4 19.6 15.4 Z" />
    </svg>
  );
}

export function ArrowRightIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M4 12.1 L19.6 11.9" />
      <path d="M14.2 5.9 L20 12 L14.1 18.2" />
    </svg>
  );
}

export function ArrowLeftIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M20 12 L4.4 12.1" />
      <path d="M9.8 18.1 L4 12 L9.9 5.8" />
    </svg>
  );
}

export function CheckIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M4.6 12.6 L9.7 17.6 L19.4 6.6" />
    </svg>
  );
}

export function StarIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.8 L14.3 9.3 L20.2 9.7 L15.6 13.3 L17.1 19 L12 15.8 L6.9 19.1 L8.4 13.3 L3.8 9.8 L9.7 9.3 L12 3.8 Z" />
    </svg>
  );
}
