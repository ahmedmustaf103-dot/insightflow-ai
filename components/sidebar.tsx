import type { ReactNode } from "react";

export function Sidebar({
  hasDataset,
  onUploadDifferent,
  onAsk,
}: {
  hasDataset: boolean;
  onUploadDifferent: () => void;
  onAsk: () => void;
}) {
  return (
    <aside className="flex w-full shrink-0 items-center justify-between bg-sidebar px-3 py-3 text-white lg:h-screen lg:w-[88px] lg:flex-col lg:justify-start lg:px-0 lg:py-5">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 text-sm font-semibold">IF</div>
      <nav className="flex items-center gap-2 lg:mt-8 lg:flex-col" aria-label="Primary">
        <SidebarButton label="Overview" current>
          <GridIcon />
        </SidebarButton>
        <SidebarButton label="Ask" onClick={onAsk}>
          <ChatIcon />
        </SidebarButton>
        {hasDataset ? (
          <SidebarButton label="Upload a different CSV" onClick={onUploadDifferent}>
            <DataIcon />
          </SidebarButton>
        ) : null}
      </nav>
      <p className="hidden text-[11px] font-medium tracking-[0.2em] text-white/55 lg:mt-10 lg:block lg:[writing-mode:vertical-rl]">YOUR DATA</p>
      <div className="mt-auto hidden h-10 w-10 place-items-center rounded-full bg-white/15 max-lg:hidden lg:grid" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="9" r="3" />
          <path d="M6.5 18.5a5.5 5.5 0 0 1 11 0" strokeLinecap="round" />
        </svg>
      </div>
    </aside>
  );
}

function SidebarButton({
  label,
  current = false,
  onClick,
  children,
}: {
  label: string;
  current?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      className={`grid h-11 w-11 place-items-center rounded-2xl transition ${current ? "bg-white text-sidebar" : "text-white/80 hover:bg-white/10"}`}
    >
      {children}
    </button>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 16.5 4 20l3.8-1.2A8 8 0 1 0 6 16.5Z" strokeLinejoin="round" />
    </svg>
  );
}

function DataIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <ellipse cx="12" cy="7" rx="6.5" ry="2.5" />
      <path d="M5.5 7v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V7" />
      <path d="M5.5 12v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" />
    </svg>
  );
}
