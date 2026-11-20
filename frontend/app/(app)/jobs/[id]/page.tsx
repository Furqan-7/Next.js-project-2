"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ContactRow } from "@/app/components/outreach/ContactRow";
import { salary, SOURCE_LABEL } from "@/app/components/jobs/JobCard";
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Loading, PageHeader, Score, useToast } from "@/app/components/ui";
import { errorMessage, post } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";
import type { Company, Contact, Job, Match } from "@/app/types/api";

export default function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ job: Job; match: Match | null; company: Company | null; contacts: Contact[] }>(`/jobs/${id}`);
  const [ai, setAi] = useState<{ score: number; reasons: string[]; concerns: string[]; source: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote>{error ?? "Not found"}</ErrorNote>;
  const { job, match, company, contacts } = data;

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title={job.title}
        subtitle={<>{company ? <Link href={`/companies/${company.id}`} className="hover:underline">{job.companyName}</Link> : job.companyName}{job.location ? ` · ${job.location}` : ""}{salary(job) ? ` · ${salary(job)}` : ""}</>}
        actions={
          <>
            <a href={job.url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2">Open posting ↗</a>
            <Button variant="secondary" onClick={() => run("save", async () => { await post(`/jobs/${job.id}/status`, { status: "saved" }); toast("Saved to tracker"); })} loading={busy === "save"}>Save</Button>
            <Button variant="secondary" onClick={() => run("applied", async () => { await post(`/jobs/${job.id}/status`, { status: "applied" }); toast("Logged as applied"); })} loading={busy === "applied"}>I applied</Button>
          </>
        }
      />

      {job.scamScore >= 25 && (
        <div className="mb-6 rounded-xl border border-bad/30 bg-bad-soft p-4 text-sm text-bad">
          <p className="font-semibold">This posting has signs of a scam ({job.scamScore}/100)</p>
          <ul className="mt-1 list-disc pl-5">{job.scamReasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <p className="mt-2">Never pay to apply, and never share bank or ID documents before an offer.</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="People to contact" subtitle={company ? "Founders and CTOs first at startups; hiring managers and recruiters at bigger companies" : undefined} action={company && <Link className="text-sm text-brand" href={`/companies/${company.id}`}>Find more →</Link>} />
            {contacts.length ? (
              <div className="divide-y divide-border">{contacts.map((c) => <ContactRow key={c.id} contact={c} jobId={job.id} onChange={reload} />)}</div>
            ) : (
              <Empty title="No contacts yet" body="Open the company page to find the founder, CTO or recruiter and verify their email." action={company && <Link href={`/companies/${company.id}`} className="text-sm font-medium text-brand">Find people →</Link>} />
            )}
          </Card>
          <Card>
            <CardHeader title="Job description" />
            <div className="prose-plain max-h-[32rem] overflow-y-auto p-5 text-sm text-ink-2">{job.description || "No description provided."}</div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center gap-4">
              <Score value={match?.score ?? 0} size="lg" />
              <div>
                <p className="font-semibold">Match score</p>
                <p className="text-sm text-ink-3">How well this fits your profile</p>
              </div>
            </div>
            {match && (
              <>
                <ul className="mt-4 space-y-1.5 text-sm">{match.reasons.map((r) => <li key={r}>✓ {r}</li>)}</ul>
                {match.missingSkills.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">Skills you don&apos;t list</p>
                    <div className="flex flex-wrap gap-1.5">{match.missingSkills.map((s) => <Badge key={s} tone="warn">{s}</Badge>)}</div>
                  </div>
                )}
              </>
            )}
            <Button className="mt-4 w-full" variant="secondary" loading={busy === "ai"} onClick={() => run("ai", async () => { setAi(await post(`/jobs/${job.id}/ai-match`)); void reload(); })}>
              Ask AI for a second opinion
            </Button>
            {ai && (
              <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
                <p className="font-medium">AI score: {ai.score}{ai.source === "fallback" ? " (AI not configured, rule-based)" : ""}</p>
                {ai.reasons.map((r) => <p key={r} className="text-ink-2">+ {r}</p>)}
                {ai.concerns.map((r) => <p key={r} className="text-ink-3">– {r}</p>)}
              </div>
            )}
          </Card>
          <Card className="p-5 text-sm">
            <p className="mb-2 font-semibold">Found on</p>
            <ul className="space-y-1">{job.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">{SOURCE_LABEL[s.source] ?? s.source} ↗</a></li>)}</ul>
            {company?.product && <p className="mt-4 text-ink-2"><span className="font-medium text-ink">Product:</span> {company.product}</p>}
            {company && company.techStack.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{company.techStack.slice(0, 10).map((t) => <Badge key={t}>{t}</Badge>)}</div>}
          </Card>
        </div>
      </div>
    </>
  );
}
