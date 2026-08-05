import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1 className={`${eyebrow ? "mt-1" : ""} page-title break-words`}>{title}</h1>{description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{description}</p>}</div>
    {actions && <div className="shrink-0">{actions}</div>}
  </header>;
}

export function EmptyState({ icon = "check", title, description, action }: { icon?: string; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-state-icon"><Icon name={icon} className="h-6 w-6"/></span><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-faint">{description}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

export function ClientAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const classes = { sm:"h-9 w-9 rounded-xl text-[11px]", md:"h-11 w-11 rounded-[14px] text-xs", lg:"h-14 w-14 rounded-2xl text-base" };
  const initials = name.split(" ").filter(Boolean).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  return <span className={`grid shrink-0 place-items-center bg-[#e8f2ff] font-bold text-[#0b5e9f] ${classes[size]}`} aria-hidden="true">{initials}</span>;
}

export function ProgressBar({ value, label, successAt = 100 }: { value: number; label: string; successAt?: number }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return <div><div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="text-ink-faint">{label}</span><strong>{safeValue}%</strong></div><div className="progress-track" role="progressbar" aria-label={`${label} : ${safeValue}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeValue}><span className={`progress-fill ${safeValue >= successAt ? "!bg-state-approved" : ""}`} style={{ transform:`scaleX(${safeValue / 100})` }}/></div></div>;
}

export function StatusDot({ tone = "neutral", children }: { tone?: "neutral" | "success" | "warning" | "danger" | "info"; children: ReactNode }) {
  const tones = { neutral:"bg-[#eef1f5] text-[#526175]", success:"bg-[#e8f8f1] text-[#107b54]", warning:"bg-[#fff4e5] text-[#9a5708]", danger:"bg-[#ffedef] text-[#c9323d]", info:"bg-[#e8f2ff] text-[#0b5e9f]" };
  return <span className={`badge gap-1.5 ${tones[tone]}`}><i className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"/>{children}</span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton block ${className}`} aria-hidden="true"/>;
}
