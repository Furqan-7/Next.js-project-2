"use client";

import { useState } from "react";
import { errorMessage, post } from "@/app/services/api";
import type { Contact } from "@/app/types/api";
import { ContactActions } from "@/app/components/outreach/Composer";
import { Badge, Button, useToast } from "@/app/components/ui";

const ROLE_LABEL: Record<string, string> = { founder: "Founder", cto: "CTO / Eng lead", hiring_manager: "Hiring manager", recruiter: "Recruiter", engineer: "Engineer", other: "Contact" };

export function EmailStatus({ contact }: { contact: Contact }) {
  if (!contact.email) return <Badge tone="neutral">No email yet</Badge>;
  const tone = contact.emailStatus === "valid" ? "ok" : contact.emailStatus === "invalid" ? "bad" : contact.emailStatus === "catch_all" || contact.emailStatus === "risky" ? "warn" : "neutral";
  const label = contact.emailStatus === "valid" ? "Verified" : contact.emailStatus === "catch_all" ? "Catch-all domain" : contact.emailStatus.replace("_", " ");
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-sm">{contact.email}</span>
      <Badge tone={tone}>{label} · {contact.emailConfidence}%</Badge>
    </span>
  );
}

export function ContactRow({ contact, jobId, onChange }: { contact: Contact; jobId?: string; onChange?: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (what: string, path: string, ok: string) => {
    setBusy(what);
    try {
      await post(path);
      toast(ok);
      onChange?.();
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium">
            {contact.name} <Badge className="ml-1">{ROLE_LABEL[contact.role] ?? contact.role}</Badge>
          </p>
          {contact.title && <p className="text-sm text-ink-3">{contact.title}</p>}
          <div className="mt-1"><EmailStatus contact={contact} /></div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-ink-3">
            {contact.linkedinUrl && <a className="hover:underline" href={contact.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>}
            {contact.twitterUrl && <a className="hover:underline" href={contact.twitterUrl} target="_blank" rel="noreferrer">X</a>}
            {contact.githubUrl && <a className="hover:underline" href={contact.githubUrl} target="_blank" rel="noreferrer">GitHub</a>}
            <span>via {contact.source}</span>
          </div>
          {contact.recentPosts.length > 0 && (
            <ul className="mt-2 space-y-1">
              {contact.recentPosts.slice(0, 3).map((p) => (
                <li key={p.title} className="text-xs text-ink-2">
                  <Badge className="mr-1">{p.source}</Badge>
                  {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">{p.title}</a> : p.title}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {contact.email && <Button size="sm" variant="ghost" loading={busy === "v"} onClick={() => run("v", `/contacts/${contact.id}/verify`, "Verification finished")}>Verify</Button>}
          <Button size="sm" variant="ghost" loading={busy === "p"} onClick={() => run("p", `/contacts/${contact.id}/posts`, "Fetched recent posts")}>Recent posts</Button>
          <Button size="sm" variant={open ? "secondary" : "primary"} onClick={() => setOpen(!open)}>{open ? "Close" : "Write"}</Button>
        </div>
      </div>
      {contact.emailCandidates.length > 1 && !contact.emailCandidates.some((c) => c.status === "valid") && (
        <details className="mt-2 text-xs text-ink-3">
          <summary className="cursor-pointer">Other likely addresses</summary>
          <ul className="mt-1 space-y-0.5 font-mono">
            {contact.emailCandidates.map((c) => <li key={c.email}>{c.email} · {c.confidence}%{c.status ? ` · ${c.status}` : ""}</li>)}
          </ul>
        </details>
      )}
      {open && <div className="mt-4 border-t border-border pt-4"><ContactActions contact={contact} jobId={jobId} /></div>}
    </div>
  );
}
