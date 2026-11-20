"use client";

import { checkSpam, TONES, type Tone } from "shared";
import { useMemo, useState } from "react";
import { errorMessage, patch, post } from "@/app/services/api";
import type { Contact, Message } from "@/app/types/api";
import { Badge, Button, ErrorNote, Input, Select, Textarea, useToast } from "@/app/components/ui";

const TONE_LABEL: Record<Tone, string> = { formal: "Formal", casual: "Casual", founder: "Founder-to-founder" };

/** Live spam check, run in the browser on every keystroke. */
export function SpamMeter({ subject, body }: { subject: string; body: string }) {
  const r = useMemo(() => checkSpam(subject, body), [subject, body]);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge tone={r.level === "good" ? "ok" : r.level === "ok" ? "warn" : "bad"}>Spam risk: {r.level}</Badge>
      {r.hits.map((h) => (
        <span key={h.phrase} className="text-ink-3">
          “{h.phrase}”{h.suggestion ? ` → try “${h.suggestion}”` : ""}
        </span>
      ))}
      {r.issues.map((i) => <span key={i} className="text-ink-3">{i}</span>)}
    </div>
  );
}

/** Edit + approve a drafted email: subject variants, body, tone regeneration, schedule or send now. */
export function MessageEditor({ message, onDone }: { message: Message; onDone?: () => void }) {
  const toast = useToast();
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = ["draft", "pending_approval", "scheduled"].includes(message.status);

  const act = async (what: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
      toast(ok);
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!editable} />
        </div>
        {message.subjectVariants.length > 1 && editable && (
          <Select label="Other subject ideas" value="" onChange={(e) => e.target.value && setSubject(e.target.value)} className="sm:w-64">
            <option value="">Pick one…</option>
            {message.subjectVariants.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        )}
      </div>
      <Textarea label="Email" rows={10} value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable} />
      <SpamMeter subject={subject} body={body} />
      {error && <ErrorNote>{error}</ErrorNote>}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button loading={busy === "approve"} onClick={() => act("approve", () => post(`/outreach/messages/${message.id}/approve`, { subject, body }), "Approved. Scheduled for a good time in their time zone")}>
            Approve & schedule
          </Button>
          <Button variant="secondary" loading={busy === "now"} onClick={() => act("now", () => post(`/outreach/messages/${message.id}/approve`, { subject, body, sendNow: true }), "Queued to send now")}>
            Send now
          </Button>
          <Button variant="ghost" loading={busy === "save"} onClick={() => act("save", () => patch(`/outreach/messages/${message.id}`, { subject, body }), "Saved")}>
            Save
          </Button>
          <Select aria-label="Rewrite in tone" value="" className="w-auto" onChange={(e) => e.target.value && act("tone", async () => {
            const r = await post<{ message: Message }>(`/outreach/messages/${message.id}/regenerate`, { tone: e.target.value });
            setSubject(r.message.subject);
            setBody(r.message.body);
          }, "Rewritten")}>
            <option value="">Rewrite as…</option>
            {TONES.map((t) => <option key={t} value={t}>{TONE_LABEL[t]}</option>)}
          </Select>
          <Button variant="ghost" loading={busy === "cancel"} onClick={() => act("cancel", () => post(`/outreach/messages/${message.id}/cancel`), "Cancelled")}>
            Discard
          </Button>
        </div>
      )}
    </div>
  );
}

/** Generate an email / LinkedIn note / DM / cover letter for one contact. */
export function ContactActions({ contact, jobId, onDrafted }: { contact: Contact; jobId?: string; onDrafted?: (m: Message) => void }) {
  const toast = useToast();
  const [tone, setTone] = useState<Tone>("casual");
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Message | null>(null);
  const [text, setText] = useState<{ kind: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const email = async () => {
    setBusy("email");
    setError(null);
    try {
      const r = await post<{ message: Message }>("/outreach/drafts", { contactId: contact.id, jobId, tone });
      setDraft(r.message);
      onDrafted?.(r.message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const gen = async (kind: "linkedin_note" | "linkedin_dm" | "cover_letter") => {
    setBusy(kind);
    setError(null);
    try {
      const r = await post<{ draft: { content: string } }>("/outreach/generate", { kind, contactId: contact.id, jobId, tone });
      setText({ kind, content: r.draft.content });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Tone" value={tone} onChange={(e) => setTone(e.target.value as Tone)} className="w-auto">
          {TONES.map((t) => <option key={t} value={t}>{TONE_LABEL[t]}</option>)}
        </Select>
        <Button size="sm" loading={busy === "email"} disabled={!contact.email || contact.emailStatus === "invalid"} onClick={email}>Draft email</Button>
        <Button size="sm" variant="secondary" loading={busy === "linkedin_note"} onClick={() => gen("linkedin_note")}>LinkedIn note</Button>
        <Button size="sm" variant="secondary" loading={busy === "linkedin_dm"} onClick={() => gen("linkedin_dm")}>LinkedIn DM</Button>
        {jobId && <Button size="sm" variant="secondary" loading={busy === "cover_letter"} onClick={() => gen("cover_letter")}>Cover letter</Button>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {draft && <MessageEditor message={draft} onDone={() => setDraft(null)} />}
      {text && (
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-ink-3">{text.kind.replace("_", " ")} · {text.content.length} chars{text.kind === "linkedin_note" ? " / 300" : ""}</span>
            <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard.writeText(text.content); toast("Copied. Paste it into LinkedIn"); }}>Copy</Button>
          </div>
          <p className="prose-plain text-sm">{text.content}</p>
        </div>
      )}
    </div>
  );
}
