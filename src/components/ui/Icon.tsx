import type { ReactNode } from "react";

export type IconName =
  | "arrow"
  | "bag"
  | "box"
  | "calendar"
  | "check"
  | "chevron"
  | "clock"
  | "close"
  | "download"
  | "factory"
  | "file"
  | "home"
  | "menu"
  | "minus"
  | "plus"
  | "refresh"
  | "search"
  | "shield"
  | "trend"
  | "users"
  | "warning"
  | "wifi";

const paths: Record<IconName, ReactNode> = {
  arrow: <path d="m9 18 6-6-6-6" />,
  bag: (
    <>
      <path d="M6 7h12l-1 13H7L6 7Z" />
      <path d="M9 9V5a3 3 0 0 1 6 0v4" />
    </>
  ),
  box: (
    <>
      <path d="m21 8-9 5-9-5 9-5 9 5Z" />
      <path d="m3 8 9 5 9-5v9l-9 5-9-5V8Z" />
      <path d="M12 13v9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  download: (
    <>
      <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14" />
    </>
  ),
  factory: (
    <>
      <path d="M3 21V9l6 3V9l6 3V5h6v16H3Z" />
      <path d="M7 17h1m4 0h1m4 0h1" />
    </>
  ),
  file: (
    <>
      <path d="M6 2h8l4 4v16H6V2Z" />
      <path d="M14 2v5h5M9 13h6m-6 4h6" />
    </>
  ),
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v11h14V10M9 21v-7h6v7" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M20 6v5h-5" />
      <path d="M19 11a7.5 7.5 0 1 0 .2 5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  trend: (
    <>
      <path d="m3 17 6-6 4 4 8-9" />
      <path d="M15 6h6v6" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.8M16 3.2a4 4 0 0 1 0 7.6" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3 2 21h20L12 3Z" />
      <path d="M12 9v5m0 3h.01" />
    </>
  ),
  wifi: (
    <>
      <path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" />
      <path d="M12 20h.01" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
