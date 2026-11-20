"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CategoryBadge } from "@/app/components/inbox/CategoryBadge";
import { ReplyDetail } from "@/app/components/inbox/ReplyDetail";
import { Card, Empty, Loading, PageHeader, Tabs, timeAgo } from "@/app/components/ui";
import { useApi } from "@/app/hooks/useApi";
import type { Reply } from "@/app/types/api";

type Filter = "all" | "interested" | "asked_for_resume" | "referral" | "rejected" | "out_of_office";

function InboxInner() {
  const params = useSearchParams();
  const { data, loading, reload } = useApi<{ items: Reply[] }>("/inbox");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(params.get("reply"));
  const items = (data?.items ?? []).filter((r) => filter === "all" || r.category === filter);
  const current = data?.items.find((r) => r.id === selected) ?? items[0] ?? null;

  const count = (c: string) => (data?.items ?? []).filter((r) => r.category === c).length;

  return (
    <>
      <PageHeader title="Inbox" subtitle="Replies from your Gmail or Outlook, sorted by what they mean. Follow-ups stop automatically." />
      <Tabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "all", label: "All", count: data?.items.length },
          { id: "interested", label: "Interested", count: count("interested") },
          { id: "asked_for_resume", label: "Asked for resume", count: count("asked_for_resume") },
          { id: "referral", label: "Referrals", count: count("referral") },
          { id: "rejected", label: "Not now", count: count("rejected") },
          { id: "out_of_office", label: "Out of office", count: count("out_of_office") },
        ]}
      />
      {loading && !data ? <Loading /> : !items.length ? (
        <Card className="mt-4"><Empty title="No replies yet" body="When someone answers, it shows up here within a minute, with a suggested response." /></Card>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <ul className="divide-y divide-border">
              {items.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSelected(r.id)} className={`block w-full px-4 py-3 text-left hover:bg-surface-2 ${current?.id === r.id ? "bg-surface-2" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${r.handled ? "text-ink-2" : "font-semibold"}`}>{r.contact?.name ?? r.fromEmail}</span>
                      <CategoryBadge category={r.category} />
                    </div>
                    <p className="truncate text-xs text-ink-3">{r.company?.name} · {timeAgo(r.receivedAt)}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-ink-2">{r.body}</p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {current && <ReplyDetail key={current.id} reply={current} onChanged={reload} />}
        </div>
      )}
    </>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={<Loading />}>
      <InboxInner />
    </Suspense>
  );
}
