"use client";

import Link from "next/link";
import { use, useState } from "react";
import { CategoryBadge } from "@/app/components/inbox/CategoryBadge";
import { Badge, Button, Card, CardHeader, ErrorNote, Input, Loading, PageHeader, Tabs, Textarea, timeAgo, useToast } from "@/app/components/ui";
import { errorMessage, patch, post } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";
import type { Message } from "@/app/types/api";

interface Detail {
  application: { id: string; stage: string; roleTitle: string | null; source: string; appliedVia: string | null; createdAt: string };
  company: { id: string; name: string; domain: string | null };
  job: { id: string; title: string; url: string } | null;
  contact: { id: string; name: string; title: string | null; email: string | null } | null;
  events: { id: string; type: string; payload: Record<string, unknown>; createdAt: string }[];
  messages: Message[];
  replies: { id: string; category: string; body: string; receivedAt: string; suggestedReply: string | null }[];
  reminders: { id: string; text: string; dueAt: string; done: boolean }[];
  prep: { content: { companyBrief: string; likelyQuestions: { question: string; why: string; category: string }[]; yourStories: { prompt: string; story: string; project?: string }[]; questionsToAsk: string[]; negotiation: string[]; checklist: string[] }; createdAt: string } | null;
}

const EVENT_LABEL: Record<string, (p: Record<string, unknown>) => string> = {
  created: () => "Added to tracker",
  stage_changed: (p) => `Moved ${p.from} → ${p.to}${p.reason ? ` (${p.reason})` : ""}`,
  email_sent: (p) => `Email sent: “${p.subject}”`,
  draft_created: (p) => `Draft created (step ${p.step})`,
  reply: (p) => `Reply received: ${String(p.category).replace("_", " ")}`,
  note: (p) => String(p.text),
  reminder: (p) => `Reminder set: ${p.text}`,
  sequence_stopped: (p) => `Follow-ups stopped: ${p.reason}`,
  bounced: (p) => `Bounced: ${p.to}`,
  out_of_office: () => "Out-of-office reply; follow-ups postponed",
  manual_apply: (p) => `Applied${p.via ? ` via ${p.via}` : ""}`,
  interview_scheduled: () => "Interview scheduled",
  linkedin_note_generated: () => "LinkedIn note generated",
  linkedin_dm_generated: () => "LinkedIn DM generated",
  cover_letter_generated: () => "Cover letter generated",
};

export default function ApplicationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Detail>(`/crm/applications/${id}`);
  const [tab, setTab] = useState<"timeline" | "emails" | "prep">("timeline");
  const [note, setNote] = useState("");
  const [rem, setRem] = useState({ text: "", dueAt: "" });
  const [busy, setBusy] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote>{error ?? "Not found"}</ErrorNote>;
  const { application: app, company, job, contact, events, messages, replies, reminders, prep } = data;

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

  return (
    <>
      <PageHeader
        title={company.name}
        subtitle={<>{job ? <Link className="hover:underline" href={`/jobs/${job.id}`}>{job.title}</Link> : app.roleTitle ?? "General outreach"}{contact ? ` · ${contact.name}` : ""}</>}
        actions={
          <>
            <Badge tone="brand" className="h-10 px-3 text-sm">{app.stage}</Badge>
            {app.stage !== "offer" && <Button variant="secondary" loading={busy === "offer"} onClick={() => act("offer", () => patch(`/crm/applications/${id}`, { stage: "offer" }), "🎉 Moved to Offer")}>Got an offer</Button>}
            <Link href={`/companies/${company.id}`} className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2">Company</Link>
          </>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "timeline", label: "Timeline", count: events.length }, { id: "emails", label: "Emails & replies", count: messages.length + replies.length }, { id: "prep", label: "Interview prep" }]} />
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {tab === "timeline" && (
            <Card>
              <form className="flex gap-2 border-b border-border p-4" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void act("note", async () => { await post(`/crm/applications/${id}/notes`, { text: note }); setNote(""); }, "Note added"); }}>
                <Input aria-label="Add a note" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button type="submit" loading={busy === "note"}>Add</Button>
              </form>
              <ol className="divide-y divide-border">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3 px-5 py-3 text-sm">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />
                    <div className="min-w-0 flex-1">
                      <p className={e.type === "note" ? "prose-plain text-ink" : "text-ink-2"}>{(EVENT_LABEL[e.type] ?? (() => e.type.replace(/_/g, " ")))(e.payload)}</p>
                      <p className="text-xs text-ink-3">{new Date(e.createdAt).toLocaleString()}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          {tab === "emails" && (
            <div className="space-y-3">
              {[...messages.map((m) => ({ kind: "out" as const, at: m.sentAt ?? m.scheduledAt ?? m.createdAt, m })), ...replies.map((r) => ({ kind: "in" as const, at: r.receivedAt, r }))]
                .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
                .map((x) =>
                  x.kind === "out" ? (
                    <Card key={x.m.id} className="p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{x.m.subject}</p>
                        <Badge tone={x.m.status === "sent" ? "ok" : "neutral"}>{x.m.status.replace("_", " ")}</Badge>
                      </div>
                      <p className="text-xs text-ink-3">You → {x.m.toEmail} · {x.m.step === 0 ? "first email" : `follow-up ${x.m.step}`} · {timeAgo(x.at)}{x.m.openedAt ? " · opened" : ""}</p>
                      <p className="prose-plain mt-2 text-sm text-ink-2">{x.m.body}</p>
                    </Card>
                  ) : (
                    <Card key={x.r.id} className="border-brand/40 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">Reply</p>
                        <CategoryBadge category={x.r.category} />
                      </div>
                      <p className="text-xs text-ink-3">{timeAgo(x.at)}</p>
                      <p className="prose-plain mt-2 text-sm text-ink-2">{x.r.body}</p>
                    </Card>
                  ),
                )}
              {messages.length + replies.length === 0 && <Card className="p-6 text-sm text-ink-3">No emails yet.</Card>}
            </div>
          )}
          {tab === "prep" && (
            prep ? (
              <div className="space-y-4">
                <Card className="p-5"><p className="text-xs font-medium uppercase tracking-wide text-ink-3">Company brief</p><p className="mt-2 text-sm">{prep.content.companyBrief}</p></Card>
                <Card>
                  <CardHeader title="Likely questions" />
                  <ul className="divide-y divide-border">{prep.content.likelyQuestions.map((q) => <li key={q.question} className="px-5 py-3 text-sm"><Badge className="mr-2">{q.category}</Badge>{q.question}<p className="mt-0.5 text-xs text-ink-3">{q.why}</p></li>)}</ul>
                </Card>
                <Card>
                  <CardHeader title="Your stories" subtitle="STAR answers from your real projects" />
                  <ul className="divide-y divide-border">{prep.content.yourStories.map((s) => <li key={s.prompt} className="px-5 py-3 text-sm"><p className="font-medium">{s.prompt}{s.project ? ` · ${s.project}` : ""}</p><p className="mt-1 text-ink-2">{s.story}</p></li>)}</ul>
                </Card>
                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="p-5"><p className="font-semibold">Questions to ask them</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">{prep.content.questionsToAsk.map((q) => <li key={q}>{q}</li>)}</ul></Card>
                  <Card className="p-5"><p className="font-semibold">Negotiation</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">{prep.content.negotiation.map((q) => <li key={q}>{q}</li>)}</ul></Card>
                </div>
                <Card className="p-5"><p className="font-semibold">Checklist</p><ul className="mt-2 space-y-1 text-sm text-ink-2">{prep.content.checklist.map((q) => <li key={q}><label className="flex gap-2"><input type="checkbox" /> {q}</label></li>)}</ul></Card>
                <p className="text-xs text-ink-3">Want to rehearse out loud? Use these questions in a mock-interview tool (DevPrep or similar).</p>
                <Button variant="secondary" loading={busy === "prep"} onClick={() => act("prep", () => post(`/crm/applications/${id}/prep`), "Prep pack rebuilt")}>Rebuild prep pack</Button>
              </div>
            ) : (
              <Card className="p-6 text-center">
                <p className="font-medium">No prep pack yet</p>
                <p className="mt-1 text-sm text-ink-3">It&apos;s built automatically when this moves to Interview, or you can build one now.</p>
                <Button className="mt-4" loading={busy === "prep"} onClick={() => act("prep", () => post(`/crm/applications/${id}/prep`), "Prep pack ready")}>Build prep pack</Button>
              </Card>
            )
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Reminders" />
            <ul className="divide-y divide-border">
              {reminders.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-5 py-3 text-sm">
                  <input type="checkbox" checked={r.done} aria-label={`Done: ${r.text}`} onChange={(e) => act("rem", () => patch(`/crm/reminders/${r.id}`, { done: e.target.checked }), "Updated")} />
                  <span className={r.done ? "text-ink-3 line-through" : ""}>{r.text}</span>
                  <span className="ml-auto text-xs text-ink-3">{timeAgo(r.dueAt)}</span>
                </li>
              ))}
            </ul>
            <form className="space-y-2 border-t border-border p-4" onSubmit={(e) => { e.preventDefault(); void act("addrem", async () => { await post("/crm/reminders", { text: rem.text, dueAt: new Date(rem.dueAt).toISOString(), applicationId: id }); setRem({ text: "", dueAt: "" }); }, "Reminder set"); }}>
              <Input aria-label="Reminder" placeholder="Follow up with recruiter" required value={rem.text} onChange={(e) => setRem({ ...rem, text: e.target.value })} />
              <Input aria-label="When" type="datetime-local" required value={rem.dueAt} onChange={(e) => setRem({ ...rem, dueAt: e.target.value })} />
              <Button type="submit" size="sm" loading={busy === "addrem"}>Add reminder</Button>
            </form>
          </Card>
          {replies[0]?.suggestedReply && (
            <Card className="p-5">
              <p className="font-semibold">Suggested next reply</p>
              <Textarea readOnly rows={6} value={replies[0].suggestedReply} className="mt-2" />
              <Link href={`/inbox?reply=${replies[0].id}`} className="mt-2 inline-block text-sm text-brand">Reply from inbox →</Link>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
