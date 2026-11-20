"use client";

import { useState } from "react";
import type { RateRow } from "@/app/types/api";
import { pct } from "@/app/components/ui";

/**
 * Daily outreach volume: grouped columns (sent vs replies) on one count axis.
 * Colors are validated categorical slots 1–2; legend + hover tooltip; recessive grid.
 */
export function TimelineChart({ data }: { data: { date: string; sent: number; replies: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="p-6 text-sm text-ink-3">No emails sent in this period yet.</p>;
  const H = 160;
  const max = Math.max(1, ...data.map((d) => d.sent));
  const ticks = [0, Math.ceil(max / 2), max];
  const groupW = Math.max(14, Math.min(40, 640 / data.length));
  const barW = Math.max(4, (groupW - 6) / 2);
  const W = data.length * groupW;
  const y = (v: number) => H - (v / max) * H;
  const h = hover !== null ? data[hover] : null;

  return (
    <figure className="p-5">
      <div className="mb-3 flex items-center gap-4 text-xs text-ink-2" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-series-1" />Sent</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-series-2" />Replies</span>
      </div>
      <div className="relative flex">
        <div className="flex w-8 shrink-0 flex-col justify-between pb-5 text-right text-[11px] tabular-nums text-ink-3" style={{ height: H + 20 }}>
          {[...ticks].reverse().map((t) => <span key={t} className="-translate-y-1/2 pr-1.5 first:translate-y-0 last:translate-y-0">{t}</span>)}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <svg width={W} height={H + 20} role="img" aria-label={`Emails sent and replies per day, ${data.length} days`} className="block">
            {ticks.map((t) => <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="var(--color-grid)" strokeWidth={1} />)}
            {data.map((d, i) => {
              const x = i * groupW + 3;
              return (
                <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.date}: ${d.sent} sent, ${d.replies} replies`}>
                  <rect x={i * groupW} y={0} width={groupW} height={H} fill={hover === i ? "var(--color-surface-2)" : "transparent"} />
                  <Column x={x} w={barW} top={y(d.sent)} base={H} fill="var(--color-series-1)" />
                  <Column x={x + barW + 2} w={barW} top={y(d.replies)} base={H} fill="var(--color-series-2)" />
                  {(data.length <= 14 || i % Math.ceil(data.length / 10) === 0) && (
                    <text x={i * groupW + groupW / 2} y={H + 14} textAnchor="middle" fontSize={10} fill="var(--color-ink-3)">{d.date.slice(5)}</text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        {h && (
          <div className="pointer-events-none absolute right-2 top-0 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
            <p className="font-medium text-ink">{h.date}</p>
            <p className="text-ink-2"><span className="mr-1 inline-block size-2 rounded-sm bg-series-1" />{h.sent} sent</p>
            <p className="text-ink-2"><span className="mr-1 inline-block size-2 rounded-sm bg-series-2" />{h.replies} replies</p>
          </div>
        )}
      </div>
      <figcaption className="sr-only">Daily emails sent and replies received.</figcaption>
    </figure>
  );
}

/** Column with a 4px rounded data-end, square at the baseline. */
function Column({ x, w, top, base, fill }: { x: number; w: number; top: number; base: number; fill: string }) {
  const h = base - top;
  if (h <= 0) return null;
  const r = Math.min(4, w / 2, h);
  return <path d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`} fill={fill} />;
}

/** Reply rate per group as horizontal bars, one series, values printed at the bar end. */
export function RateBars({ rows, label }: { rows: RateRow[]; label: (k: string) => string }) {
  const [hover, setHover] = useState<string | null>(null);
  const visible = rows.filter((r) => r.sent > 0).slice(0, 8);
  if (!visible.length) return <p className="px-5 py-6 text-sm text-ink-3">Not enough data yet.</p>;
  const max = Math.max(0.01, ...visible.map((r) => r.replyRate));
  return (
    <ul className="space-y-2.5 p-5" aria-label="Reply rate by group">
      {visible.map((r) => (
        <li key={r.key} className="relative" onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-ink-2">{label(r.key)}</span>
            <span className="shrink-0 tabular-nums text-ink"><span className="font-semibold">{pct(r.replyRate)}</span> <span className="text-ink-3">of {r.sent}</span></span>
          </div>
          <div className="h-2 rounded-full bg-surface-2">
            <div className="h-2 rounded-full bg-series-1" style={{ width: `${Math.max(2, (r.replyRate / max) * 100)}%` }} />
          </div>
          {hover === r.key && (
            <div className="pointer-events-none absolute right-0 top-6 z-10 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
              <p className="font-medium text-ink">{label(r.key)}</p>
              <p className="text-ink-2">{r.sent} sent · {r.opens} opened ({pct(r.openRate)}) · {r.replies} replied · {r.positive} positive</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
