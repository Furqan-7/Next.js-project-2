"use client";

import Link from "next/link";
import { Badge, Card, Empty, LinkButton, Loading, PageHeader, pct } from "@/app/components/ui";
import { useApi } from "@/app/hooks/useApi";
import type { Campaign } from "@/app/types/api";

export default function CampaignsPage() {
  const { data, loading } = useApi<{ items: Campaign[] }>("/campaigns");
  return (
    <>
      <PageHeader title="Campaigns" subtitle="Bulk outreach with follow-ups, for example “all YC startups hiring frontend interns”." actions={<LinkButton href="/campaigns/new">New campaign</LinkButton>} />
      {loading && !data ? <Loading /> : !data?.items.length ? (
        <Card><Empty title="No campaigns yet" body="A campaign finds matching jobs, picks the best person at each company, drafts emails and follows up on day 3, 7 and 14." action={<LinkButton href="/campaigns/new">Create your first campaign</LinkButton>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.items.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`}>
              <Card className="p-5 transition hover:border-brand">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{c.name}</p>
                  <Badge tone={c.status === "active" ? "ok" : c.status === "paused" ? "warn" : "neutral"}>{c.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-ink-3">
                  {c.mode === "autopilot" ? "Autopilot" : "Approval mode"} · {c.tone} tone · follow-ups on day {c.sequence.slice(1).map((s) => s.dayOffset).join(", ") || "none"}
                  {c.abTest ? " · A/B subjects" : ""}
                </p>
                {c.stats && (
                  <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
                    {[
                      ["Sent", c.stats.sent],
                      ["Pending", c.stats.pending + c.stats.scheduled],
                      ["Opened", c.stats.sent ? pct(c.stats.opened / c.stats.sent) : "–"],
                      ["Replied", c.stats.sent ? pct(c.stats.replied / c.stats.sent) : "–"],
                    ].map(([k, v]) => (
                      <div key={k as string} className="rounded-lg bg-surface-2 py-2">
                        <dt className="text-xs text-ink-3">{k}</dt>
                        <dd className="font-semibold tabular-nums">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
