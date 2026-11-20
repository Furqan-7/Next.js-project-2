"use client";

import Link from "next/link";
import { useState } from "react";
import { MessageEditor } from "@/app/components/outreach/Composer";
import { Badge, Button, Card, Empty, Loading, PageHeader, Tabs, timeAgo, useToast } from "@/app/components/ui";
import { errorMessage, post } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";
import type { Message } from "@/app/types/api";

type Tab = "pending_approval" | "scheduled" | "sent" | "generated";
const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral" | "brand"> = { pending_approval: "warn", scheduled: "info", sent: "ok", bounced: "bad", failed: "bad", cancelled: "neutral", draft: "neutral" };

export default function OutreachPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("pending_approval");
  const all = useApi<{ items: Message[] }>("/outreach/messages");
  const generated = useApi<{ items: { id: string; kind: string; content: string; createdAt: string }[] }>("/outreach/generated");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = (all.data?.items ?? []).filter((m) => (tab === "sent" ? ["sent", "bounced", "failed"].includes(m.status) : m.status === tab));
  const count = (s: string[]) => (all.data?.items ?? []).filter((m) => s.includes(m.status)).length;

  return (
    <>
      <PageHeader
        title="Outreach"
        subtitle="Review every email before it goes out, or switch a campaign to autopilot."
        actions={tab === "pending_approval" && items.length > 1 ? (
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await post<{ approved: number }>("/outreach/messages/approve-all");
              toast(`${r.approved} emails approved and scheduled`);
              void all.reload();
            } catch (e) {
              toast(errorMessage(e), "bad");
            } finally {
              setBusy(false);
            }
          }}>Approve all ({items.length})</Button>
        ) : undefined}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "pending_approval", label: "Needs approval", count: count(["pending_approval"]) },
          { id: "scheduled", label: "Scheduled", count: count(["scheduled"]) },
          { id: "sent", label: "Sent", count: count(["sent", "bounced", "failed"]) },
          { id: "generated", label: "LinkedIn & cover letters", count: generated.data?.items.length },
        ]}
      />
      <div className="mt-4">
        {tab === "generated" ? (
          <Card>
            {(generated.data?.items ?? []).length === 0 ? <Empty title="Nothing generated yet" body="Open a contact and generate a LinkedIn note, DM or cover letter. You copy and send these yourself." /> : (
              <ul className="divide-y divide-border">
                {generated.data!.items.map((g) => (
                  <li key={g.id} className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <Badge>{g.kind.replace("_", " ")}</Badge>
                      <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard.writeText(g.content); toast("Copied"); }}>Copy</Button>
                    </div>
                    <p className="prose-plain line-clamp-6 text-sm text-ink-2">{g.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : all.loading && !all.data ? <Loading /> : items.length === 0 ? (
          <Card><Empty title={tab === "pending_approval" ? "Nothing waiting for approval" : "Nothing here yet"} body="Draft an email from any job or company page, or launch a campaign." action={<Link href="/campaigns/new" className="text-sm font-medium text-brand">Create a campaign →</Link>} /></Card>
        ) : (
          <Card className="divide-y divide-border">
            {items.map((m) => (
              <div key={m.id} className="p-4">
                <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.subject}</p>
                    <p className="truncate text-sm text-ink-3">
                      To {m.contact?.name ?? m.toEmail}{m.company ? ` at ${m.company.name}` : ""} · {m.step === 0 ? "first email" : `follow-up ${m.step}`}
                      {m.variant ? ` · variant ${m.variant}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={STATUS_TONE[m.status]}>{m.status.replace("_", " ")}</Badge>
                    <span className="text-xs text-ink-3">
                      {m.status === "scheduled" || m.status === "pending_approval" ? (m.scheduledAt ? `sends ${timeAgo(m.scheduledAt)}` : "") : m.sentAt ? `sent ${timeAgo(m.sentAt)}` : ""}
                      {m.openedAt ? " · opened" : ""}{m.repliedAt ? " · replied" : ""}
                    </span>
                  </div>
                </button>
                {m.error && <p className="mt-1 text-xs text-bad">{m.error}</p>}
                {open === m.id && <div className="mt-4"><MessageEditor message={m} onDone={() => { setOpen(null); void all.reload(); }} /></div>}
              </div>
            ))}
          </Card>
        )}
      </div>
    </>
  );
}
