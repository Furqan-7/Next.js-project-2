"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink hover:opacity-90",
  secondary: "bg-surface text-ink border border-border hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2",
  danger: "bg-bad text-white hover:opacity-90",
};

export function Button({ variant = "primary", size = "md", loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", className, children }: { href: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx("inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition", variants[variant], className)}>
      {children}
    </Link>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("rounded-[var(--radius-card)] border border-border bg-surface", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "brand" | "ok" | "warn" | "bad" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  brand: "bg-brand-soft text-brand",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
};
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function Input({ label, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  const auto = useId();
  const id = rest.id ?? auto;
  return (
    <div className="block">
      {label && <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink-2">{label}</label>}
      <input {...rest} id={id} className={cx("h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none", className)} />
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </div>
  );
}

export function Textarea({ label, hint, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string }) {
  const auto = useId();
  const id = rest.id ?? auto;
  return (
    <div className="block">
      {label && <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink-2">{label}</label>}
      <textarea {...rest} id={id} className={cx("w-full rounded-lg border border-border bg-surface p-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none", className)} />
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </div>
  );
}

export function Select({ label, children, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const auto = useId();
  const id = rest.id ?? auto;
  return (
    <div className="block">
      {label && <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink-2">{label}</label>}
      <select {...rest} id={id} className={cx("h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink focus:border-brand focus:outline-none", className)}>
        {children}
      </select>
    </div>
  );
}

/** Multi-select as toggleable chips. */
export function Chips<T extends string>({ options, value, onChange, labels }: { options: readonly T[]; value: T[]; onChange: (v: T[]) => void; labels?: Partial<Record<T, string>> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            type="button"
            key={o}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cx("rounded-full border px-3 py-1.5 text-sm transition", on ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface text-ink-2 hover:bg-surface-2")}
          >
            {labels?.[o] ?? o.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}

export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft("");
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface p-1.5">
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-sm text-ink">
          {v}
          <button type="button" aria-label={`Remove ${v}`} className="text-ink-3 hover:text-bad" onClick={() => onChange(value.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        placeholder={placeholder}
        className="min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-ink placeholder:text-ink-3 focus:outline-none"
      />
    </div>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span aria-hidden className={cx("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", small ? "size-3.5" : "size-5")} />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-ink-3">
      <Spinner /> {label}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="font-medium text-ink">{title}</p>
      {body && <p className="max-w-md text-sm text-ink-3">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{children}</div>;
}

/** Match score as a coloured number with an accessible label. */
export function Score({ value, size = "md" }: { value: number; size?: "sm" | "md" | "lg" }) {
  const tone = value >= 75 ? "text-ok bg-ok-soft" : value >= 50 ? "text-warn bg-warn-soft" : "text-ink-3 bg-surface-2";
  const dims = size === "lg" ? "size-16 text-xl" : size === "sm" ? "size-9 text-xs" : "size-11 text-sm";
  return (
    <div className={cx("flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums", tone, dims)} aria-label={`Match score ${value} out of 100`}>
      {value}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
    </Card>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", value === t.id ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink-2")}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-xs text-ink-3">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- toasts
type ToastT = { id: number; text: string; tone: "ok" | "bad" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "bad") => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastT[]>([]);
  const push = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cx("rounded-lg border px-4 py-3 text-sm shadow-lg", t.tone === "ok" ? "border-ok/30 bg-surface text-ink" : "border-bad/30 bg-bad-soft text-bad")}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const fut = s < 0;
  const a = Math.abs(s);
  const v = a < 60 ? `${Math.round(a)}s` : a < 3600 ? `${Math.round(a / 60)}m` : a < 86400 ? `${Math.round(a / 3600)}h` : `${Math.round(a / 86400)}d`;
  return fut ? `in ${v}` : `${v} ago`;
}

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}
