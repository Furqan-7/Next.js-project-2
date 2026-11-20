"use client";

import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { MessageEditor } from "@/app/components/outreach/Composer";
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Loading, PageHeader, timeAgo, useToast } from "@/app/components/ui";
import { del, errorMessage, patch, post } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";
import type { Campaign, Message } from "@/app/types/api";

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ campaign: Campaign; messages: Message[] }>(`/campaigns/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote>{error ?? "Not found"}</ErrorNote>;
  const { campaign, messages } = data;

  const act = async (what: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(what);
    try {
      await fn();
      toast(ok);
      await reload();
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  const byStatus = (s: string) => messages.filter((m) => m.status === s).length;
  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={`${campaign.mode === "autopilot" ? "Autopilot" : "Approval mode"} · ${campaign.tone} tone · follow-ups on day ${campaign.sequence.slice(1).map((s) => s.dayOffset).join(", ")}`}
        actions={
          <>
            {campaign.status === "paused" ? (
              <Button loading={busy === "status"} onClick={() => act("status", () => patch(`/campaigns/${id}`, { status: "active" }), "Campaign resumed")}>Resume</Button>
            ) : (
              <Button variant="secondary" loading={busy === "status"} onClick={() => act("status", () => patch(`/campaigns/${id}`, { status: "paused" }), "Campaign paused")}>Pause</Button>
            )}
            {campaign.mode === "approval" && <Button variant="secondary" loading={busy === "mode"} onClick={() => act("mode", () => patch(`/campaigns/${id}`, { mode: "autopilot" }), "Switched to autopilot")}>Switch to autopilot</Button>}
            <Button variant="secondary" loading={busy === "launch"} onClick={() => act("launch", () => post(`/campaigns/${id}/launch`), "Looked for new companies to contact")}>Add new matches</Button>
            <Button variant="ghost" onClick={async () => { if (confirm("Delete this campaign? Unsent emails will be cancelled.")) { await del(`/campaigns/${id}`); router.push("/campaigns"); } }}>Delete</Button>
          </>
        }
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone={campaign.status === "active" ? "ok" : "warn"}>{campaign.status}</Badge>
        <Badge tone="warn">{byStatus("pending_approval")} need approval</Badge>
        <Badge tone="info">{byStatus("scheduled")} scheduled</Badge>
        <Badge tone="ok">{byStatus("sent")} sent</Badge>
        <Badge>{messages.filter((m) => m.repliedAt).length} replied</Badge>
      </div>
      <Card>
        <CardHeader title="Emails" />
        {messages.length === 0 ? <Empty title="No emails in this campaign" body="No company matched with a verified contact yet. Try lowering the minimum score, or find people on company pages first." /> : (
          <div className="divide-y divide-border">
            {messages.map((m) => (
              <div key={m.id} className="p-4">
                <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === m.id ? null : m.id)}>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.company?.name ?? m.toEmail} · <span className="font-normal text-ink-2">{m.subject}</span></p>
                    <p className="text-sm text-ink-3">{m.contact?.name} · {m.step === 0 ? "first email" : `follow-up ${m.step}`}{m.variant ? ` · ${m.variant}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <Badge tone={m.status === "sent" ? "ok" : m.status === "pending_approval" ? "warn" : m.status === "scheduled" ? "info" : "neutral"}>{m.status.replace("_", " ")}</Badge>
                    <p className="mt-1 text-xs text-ink-3">{m.sentAt ? timeAgo(m.sentAt) : m.scheduledAt ? timeAgo(m.scheduledAt) : ""}</p>
                  </div>
                </button>
                {open === m.id && <div className="mt-4"><MessageEditor message={m} onDone={() => { setOpen(null); void reload(); }} /></div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
