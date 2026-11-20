"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, cx, ErrorNote, Input, Loading, PageHeader, Select, timeAgo, useToast } from "@/app/components/ui";
import { errorMessage, patch, post } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";
import type { Application } from "@/app/types/api";

const LABEL: Record<string, string> = { found: "Found", emailed: "Emailed", replied: "Replied", interview: "Interview", offer: "Offer", rejected: "Rejected" };
const ACCENT: Record<string, string> = { found: "bg-ink-3", emailed: "bg-info", replied: "bg-brand", interview: "bg-warn", offer: "bg-ok", rejected: "bg-bad" };

export default function TrackerPage() {
  const toast = useToast();
  const { data, loading, reload, setData } = useApi<{ stages: string[]; columns: Record<string, Application[]> }>("/crm/board");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ company: "", website: "", roleTitle: "", url: "", appliedVia: "", stage: "emailed" });
  const [error, setError] = useState<string | null>(null);

  const move = async (appId: string, to: string) => {
    if (!data) return;
    const from = Object.keys(data.columns).find((s) => data.columns[s].some((a) => a.id === appId));
    if (!from || from === to) return;
    const card = data.columns[from].find((a) => a.id === appId)!;
    // optimistic update
    setData({ ...data, columns: { ...data.columns, [from]: data.columns[from].filter((a) => a.id !== appId), [to]: [{ ...card, stage: to }, ...data.columns[to]] } });
    try {
      await patch(`/crm/applications/${appId}`, { stage: to });
      if (to === "interview") toast("Interview prep pack is ready");
    } catch (e) {
      toast(errorMessage(e), "bad");
    }
    void reload();
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await post("/crm/applications", { ...form, website: form.website || undefined, url: form.url || undefined, appliedVia: form.appliedVia || undefined });
      setShowAdd(false);
      setForm({ company: "", website: "", roleTitle: "", url: "", appliedVia: "", stage: "emailed" });
      toast("Added to your tracker");
      void reload();
    } catch (e2) {
      setError(errorMessage(e2));
    }
  };

  return (
    <>
      <PageHeader title="Tracker" subtitle="Drag cards between stages. Emails, replies and stage changes update it on their own." actions={<Button onClick={() => setShowAdd(!showAdd)}>Log an application</Button>} />
      {showAdd && (
        <Card className="mb-6">
          <CardHeader title="Log a job you applied to yourself" />
          <form onSubmit={add} className="grid gap-3 p-5 sm:grid-cols-3">
            <Input label="Company" required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            <Input label="Role" value={form.roleTitle} onChange={(e) => setForm({ ...form, roleTitle: e.target.value })} />
            <Input label="Company website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            <Input label="Job link" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <Input label="Applied via" placeholder="LinkedIn Easy Apply, referral…" value={form.appliedVia} onChange={(e) => setForm({ ...form, appliedVia: e.target.value })} />
            <Select label="Stage" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
              {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            {error && <div className="sm:col-span-3"><ErrorNote>{error}</ErrorNote></div>}
            <div className="sm:col-span-3"><Button type="submit">Add</Button></div>
          </form>
        </Card>
      )}
      {loading && !data ? <Loading /> : data && (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
          <div className="flex min-w-max gap-3">
            {data.stages.map((stage) => (
              <section
                key={stage}
                aria-label={LABEL[stage]}
                onDragOver={(e) => { e.preventDefault(); setOver(stage); }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); if (dragging) void move(dragging, stage); setDragging(null); }}
                className={cx("w-64 shrink-0 rounded-[var(--radius-card)] border bg-surface-2 p-2", over === stage ? "border-brand" : "border-border")}
              >
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="flex items-center gap-2 text-sm font-semibold"><span className={cx("size-2 rounded-full", ACCENT[stage])} />{LABEL[stage]}</span>
                  <span className="text-xs text-ink-3">{data.columns[stage].length}</span>
                </div>
                <div className="mt-1 flex min-h-24 flex-col gap-2">
                  {data.columns[stage].map((a) => (
                    <article
                      key={a.id}
                      draggable
                      onDragStart={() => setDragging(a.id)}
                      onDragEnd={() => setDragging(null)}
                      className={cx("cursor-grab rounded-lg border border-border bg-surface p-3 shadow-sm active:cursor-grabbing", dragging === a.id && "opacity-50")}
                    >
                      <Link href={`/tracker/${a.id}`} className="block">
                        <p className="truncate text-sm font-medium">{a.company.name}</p>
                        <p className="truncate text-xs text-ink-2">{a.job?.title ?? a.roleTitle ?? "General outreach"}</p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          {a.contact ? <span className="truncate text-xs text-ink-3">{a.contact.name}</span> : <span />}
                          {a.source === "manual" && <Badge>manual</Badge>}
                        </div>
                        <p className="mt-1 text-[11px] text-ink-3">{timeAgo(a.updatedAt)}</p>
                      </Link>
                      {/* Keyboard / touch alternative to drag-and-drop */}
                      <select aria-label={`Move ${a.company.name}`} value={stage} onChange={(e) => move(a.id, e.target.value)} className="mt-2 w-full rounded border border-border bg-surface px-1 py-0.5 text-xs text-ink-2">
                        {data.stages.map((s) => <option key={s} value={s}>Move to {LABEL[s]}</option>)}
                      </select>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
