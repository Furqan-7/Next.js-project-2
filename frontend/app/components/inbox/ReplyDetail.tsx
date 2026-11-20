"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage, post } from "@/app/services/api";
import type { Reply } from "@/app/types/api";
import { Button, Card, Textarea, useToast } from "../ui";
import { CategoryBadge } from "./CategoryBadge";

/** One reply: their message, your email, and an editable suggested response. Keyed by reply id. */
export function ReplyDetail({ reply, onChanged }: { reply: Reply; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [draft, setDraft] = useState(reply.suggestedReply ?? "");
  const [attach, setAttach] = useState(reply.category === "asked_for_resume");
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<{ calCom: string | null; googleCalendar: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ calCom: string | null; googleCalendar: string }>(`/inbox/${reply.id}/booking-links`)
      .then((l) => alive && setLinks(l))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [reply.id]);

  const act = async (what: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(what);
    try {
      await fn();
      toast(ok);
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5 lg:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{reply.subject}</p>
          <p className="text-sm text-ink-3">{reply.contact?.name ?? ""} &lt;{reply.fromEmail}&gt; · {new Date(reply.receivedAt).toLocaleString()}</p>
        </div>
        <CategoryBadge category={reply.category} />
      </div>
      <div className="prose-plain mt-4 rounded-lg bg-surface-2 p-4 text-sm">{reply.body}</div>
      {reply.original && (
        <details className="mt-3 text-sm text-ink-3">
          <summary className="cursor-pointer">Your email: {reply.original.subject}</summary>
          <p className="prose-plain mt-2">{reply.original.body}</p>
        </details>
      )}
      {reply.category !== "out_of_office" && (
        <div className="mt-5 space-y-3">
          <Textarea label="Your reply" rows={7} value={draft} onChange={(e) => setDraft(e.target.value)} hint="Suggested from their message. Edit freely." />
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> Attach my resume (PDF)
          </label>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy === "send"} disabled={!draft.trim()} onClick={() => act("send", () => post(`/inbox/${reply.id}/respond`, { body: draft, attachResume: attach }), "Reply queued in the same thread")}>Send reply</Button>
            {links?.calCom && <a className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-surface-2" href={links.calCom} target="_blank" rel="noreferrer">Cal.com link ↗</a>}
            {links && <a className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-surface-2" href={links.googleCalendar} target="_blank" rel="noreferrer">Add to Google Calendar ↗</a>}
            <Button variant="secondary" loading={busy === "iv"} onClick={() => act("iv", () => post(`/inbox/${reply.id}/interview`, {}), "Moved to Interview. Prep pack is ready in the tracker")}>Interview booked</Button>
            {!reply.handled && <Button variant="ghost" loading={busy === "done"} onClick={() => act("done", () => post(`/inbox/${reply.id}/handled`), "Marked as handled")}>Mark handled</Button>}
          </div>
        </div>
      )}
      {reply.applicationId && <Link href={`/tracker/${reply.applicationId}`} className="mt-4 inline-block text-sm text-brand">Open in tracker →</Link>}
    </Card>
  );
}
