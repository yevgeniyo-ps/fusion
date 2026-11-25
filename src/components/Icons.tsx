// One set of thin line icons (16 px, 1.5 stroke).

export type IconName =
  | "chevron" | "chevrons" | "close" | "plus" | "folder" | "branch" | "clone" | "tree" | "terminal" | "spark" | "camera" | "splitRight" | "splitDown" | "github" | "folderPlus" | "pull" | "check" | "maximize" | "pencil" | "select" | "more" | "sort" | "search" | "settings" | "note" | "code" | "codeBlock";

const ICONS: Record<IconName, React.ReactNode> = {
  chevron: <path d="m6 4 4 4-4 4" />,
  code: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3.5l-2 9" />,
  codeBlock: <><path d="M10 2.5h2a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5h1" /><path d="M6 6.5 4.75 8 6 9.5M10 6.5 11.25 8 10 9.5M8.75 5.5l-1.5 5" /></>,
  chevrons: <path d="M3.5 4l4 4-4 4M8.5 4l4 4-4 4" />,
  close: <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />,
  plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
  folder: <path d="M2.25 4.5c0-.7.55-1.25 1.25-1.25h2.6l1.5 1.5h4.9c.7 0 1.25.55 1.25 1.25v5.5c0 .7-.55 1.25-1.25 1.25h-9c-.7 0-1.25-.55-1.25-1.25z" />,
  branch: <><circle cx="4.5" cy="3.75" r="1.5" /><circle cx="4.5" cy="12.25" r="1.5" /><circle cx="11.5" cy="5.25" r="1.5" /><path d="M4.5 5.25v5.5M11.5 6.75c0 2.5-2 3-5 4" /></>,
  clone: <><path d="M4.25 2.25h7.5v9.5h-7.5a1.5 1.5 0 0 0-1.5 1.5V3.75a1.5 1.5 0 0 1 1.5-1.5Z" /><path d="M2.75 13.25a1.5 1.5 0 0 0 1.5 1.5h7.5v-3" /><path d="M8 4.5v4M6.25 6.75 8 8.5l1.75-1.75" /></>,
  folderPlus: <><path d="M2.25 4.5c0-.7.55-1.25 1.25-1.25h2.6l1.5 1.5h4.9c.7 0 1.25.55 1.25 1.25v5.5c0 .7-.55 1.25-1.25 1.25h-9c-.7 0-1.25-.55-1.25-1.25z" /><path d="M8 7v3.5M6.25 8.75h3.5" /></>,
  tree: <><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.75" /><path d="M6.25 2.75v10.5" /></>,
  terminal: <><rect x="2" y="2.75" width="12" height="10.5" rx="1.75" /><path d="m5 6.75 1.75 1.5L5 9.75M8.5 10h2.5" /></>,
  camera: <><path d="M2.25 5.5c0-.7.55-1.25 1.25-1.25h1.75l1.25-1.5h3l1.25 1.5h1.75c.7 0 1.25.55 1.25 1.25v6.25c0 .7-.55 1.25-1.25 1.25h-9c-.7 0-1.25-.55-1.25-1.25z" /><circle cx="8" cy="8.5" r="2.25" /></>,
  splitRight: <><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.75" /><path d="M8 2.75v10.5" /></>,
  splitDown: <><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.75" /><path d="M2.25 8h11.5" /></>,
  github: <path fill="currentColor" stroke="none" d="M8 1.25a6.75 6.75 0 0 0-2.13 13.16c.34.06.46-.15.46-.32v-1.15c-1.88.41-2.27-.9-2.27-.9-.31-.78-.75-.99-.75-.99-.61-.42.05-.41.05-.41.68.05 1.04.7 1.04.7.6 1.03 1.58.73 1.97.56.06-.44.24-.73.43-.9-1.5-.17-3.08-.75-3.08-3.34 0-.74.26-1.34.7-1.81-.07-.17-.3-.86.07-1.79 0 0 .57-.18 1.86.69a6.4 6.4 0 0 1 3.38 0c1.29-.87 1.86-.69 1.86-.69.37.93.14 1.62.07 1.79.43.47.69 1.07.69 1.81 0 2.6-1.58 3.17-3.09 3.33.24.21.46.62.46 1.25v1.86c0 .18.12.39.47.32A6.75 6.75 0 0 0 8 1.25Z" />,
  pull: <><path d="M8 2.5v8M4.75 7.5 8 10.75l3.25-3.25" /><path d="M3 13.25h10" /></>,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  maximize: <path d="M9.5 2.75h3.75V6.5M6.5 13.25H2.75V9.5M13.25 2.75 9 7M2.75 13.25 7 9" />,
  pencil: <path d="M10.75 2.75 13.25 5.25 5.75 12.75 2.75 13.25 3.25 10.25z M9.25 4.25l2.5 2.5" />,
  select: <><rect x="2.25" y="2.75" width="4.5" height="4.5" rx="1" /><path d="m3.25 5 1 1 1.75-2" /><rect x="2.25" y="9" width="4.5" height="4.5" rx="1" /><path d="M9 5h4.75M9 11.25h4.75" /></>,
  more: <><circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" /></>,
  sort: <path d="M4.5 3v10M2.5 11 4.5 13l2-2M9 4h4.5M9 8h3.25M9 12h2" />,
  settings: <><circle cx="8" cy="8" r="2" /><path d="M6.9 1.75h2.2l.35 1.75 1.3.75 1.7-.55 1.1 1.9-1.35 1.2v1.5l1.35 1.2-1.1 1.9-1.7-.55-1.3.75-.35 1.75H6.9l-.35-1.75-1.3-.75-1.7.55-1.1-1.9 1.35-1.2V7.2L2.45 6l1.1-1.9 1.7.55 1.3-.75z" /></>,
  note: <><path d="M4 2.25h5l3 3v8.5H4z" /><path d="M9 2.25v3h3M6.25 8.25h3.5M6.25 10.75h3.5" /></>,
  search: <><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3 3" /></>,
  spark: <path d="M8 2.25c.45 2.9 1.85 4.3 4.75 4.75-2.9.45-4.3 1.85-4.75 4.75C7.55 8.85 6.15 7.45 3.25 7 6.15 6.55 7.55 5.15 8 2.25Z" />,
};

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

/** "fu" + "sion": the first part bright, the second dim. */
export function Wordmark() {
  return (
    <span className="text-[40px] font-light leading-none tracking-[-0.025em]">
      <span className="text-muted">fu</span>
      <span className="font-medium text-fg">sion</span>
    </span>
  );
}
