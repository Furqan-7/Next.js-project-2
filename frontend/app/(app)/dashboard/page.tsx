"use client";

import Link from "next/link";
import { useState } from "react";
import { JobCard } from "@/app/components/jobs/JobCard";
import { CategoryBadge } from "@/app/components/inbox/CategoryBadge";
import { useSession } from "@/app/(app)/AppShell";
import { Badge, Button, Card, CardHeader, Empty, LinkButton, Loading, PageHeader, pct, Stat, timeAgo, useToast } from "@/app/components/ui";
import { errorMessage, post } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";
import type { Job, Message, Reply } from "@/app/types/api";

export default function Dashboard() {
  const { user, profile } = useSession();
  const toast = useToast();
  const feed = useApi<{ items: Job[] }>("/jobs/feed?sinceHours=72&minScore=50&limit=100");
  const pending = useApi<{ items: Message[] }>("/outreach/messages?status=pending_approval");
  const replies = useApi<{ items: Reply[] }>("/inbox");
  const funding = useApi<{ items: { id: string; companyName: string; companyId: string | null; amount: string | null; round: string | null; title: string; url: string; announcedAt: string | null }[] }>("/jobs/funding");
  const stats = useApi<{ totals: { sent: number; replyRate: number; openRate: number; positive: number } }>("/analytics/overview?days=30");
  const reminders = useApi<{ items: { id: string; text: string; dueAt: string; applicationId: string | null }[] }>("/crm/reminders");
  const [discovering, setDiscovering] = useState(false);

  const discover = async () => {
    setDiscovering(true);
    try {
      const r = await post<{ ingest: { inserted: number; merged: number } }>("/jobs/discover");
      toast(`${r.ingest.inserted} new jobs found, ${r.ingest.merged} duplicates merged`);
      void feed.reload();
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setDiscovering(false);
    }
  };

  const unhandled = (replies.data?.items ?? []).filter((r) => !r.handled && r.category !== "out_of_office");
  return (
    <>
      <PageHeader
        title={`Good to see you, ${user.name.split(" ")[0]}`}
        subtitle={profile.targetRoles.length ? `Looking for ${profile.targetRoles.map((r) => r.replace("_", " ")).join(", ")} roles` : "Finish your profile for better matches"}
        actions={
          <>
            <Button variant="secondary" loading={discovering} onClick={discover}>Find new jobs now</Button>
            <LinkButton href="/campaigns/new">New campaign</LinkButton>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New strong matches" value={feed.data?.items.length ?? "–"} hint="last 3 days, score ≥ 50" />
        <Stat label="Awaiting approval" value={pending.data?.items.length ?? "–"} hint={<Link href="/outreach" className="underline">Review drafts</Link>} />
        <Stat label="Replies to handle" value={unhandled.length} hint={<Link href="/inbox" className="underline">Open inbox</Link>} />
        <Stat label="Reply rate (30d)" value={stats.data ? pct(stats.data.totals.replyRate) : "–"} hint={stats.data ? `${stats.data.totals.sent} sent` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Today's matches" subtitle="Ranked by how well they fit your profile" action={<Link href="/jobs" className="text-sm text-brand">All jobs →</Link>} />
          {feed.loading ? <Loading /> : feed.data?.items.length ? (
            <div className="divide-y divide-border">
              {feed.data.items.slice(0, 8).map((j) => <JobCard key={j.id} job={j} />)}
            </div>
          ) : (
            <Empty title="No new matches yet" body="Run discovery or add a company's careers page. Matches appear here daily." action={<Button size="sm" onClick={discover} loading={discovering}>Find jobs</Button>} />
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Replies" action={<Link href="/inbox" className="text-sm text-brand">Inbox →</Link>} />
            {unhandled.length === 0 ? <p className="px-5 py-6 text-sm text-ink-3">No new replies. Follow-ups are running.</p> : (
              <ul className="divide-y divide-border">
                {unhandled.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <Link href={`/inbox?reply=${r.id}`} className="block px-5 py-3 hover:bg-surface-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{r.contact?.name ?? r.fromEmail}</span>
                        <CategoryBadge category={r.category} />
                      </div>
                      <p className="truncate text-xs text-ink-3">{r.company?.name} · {timeAgo(r.receivedAt)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(reminders.data?.items.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Reminders" />
              <ul className="divide-y divide-border">
                {reminders.data!.items.slice(0, 5).map((r) => (
                  <li key={r.id} className="px-5 py-3 text-sm">
                    <Link href={r.applicationId ? `/tracker/${r.applicationId}` : "/tracker"} className="hover:underline">{r.text}</Link>
                    <p className="text-xs text-ink-3">{timeAgo(r.dueAt)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Newly funded" subtitle="Startups that just raised usually hire next" />
            {(funding.data?.items ?? []).length === 0 ? <p className="px-5 py-6 text-sm text-ink-3">Funding news appears after the next discovery run.</p> : (
              <ul className="divide-y divide-border">
                {funding.data!.items.slice(0, 6).map((f) => (
                  <li key={f.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      {f.companyId ? <Link href={`/companies/${f.companyId}`} className="truncate text-sm font-medium hover:underline">{f.companyName}</Link> : <span className="text-sm font-medium">{f.companyName}</span>}
                      <Badge tone="ok">{[f.amount, f.round].filter(Boolean).join(" ")}</Badge>
                    </div>
                    <a href={f.url} target="_blank" rel="noreferrer" className="line-clamp-1 text-xs text-ink-3 hover:underline">{f.title}</a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
