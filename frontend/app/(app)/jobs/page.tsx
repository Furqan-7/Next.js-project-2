"use client";

import { useState } from "react";
import { JobCard, SOURCE_LABEL } from "@/app/components/jobs/JobCard";
import { Button, Card, CardHeader, Empty, ErrorNote, Input, Loading, PageHeader, Select, Textarea, useToast } from "@/app/components/ui";
import { errorMessage, post } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";
import type { Job } from "@/app/types/api";

export default function JobsPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [source, setSource] = useState("");
  const [remote, setRemote] = useState(false);
  const params = new URLSearchParams({ ...(q ? { q } : {}), ...(minScore ? { minScore: String(minScore) } : {}), ...(source ? { source } : {}), ...(remote ? { remote: "true" } : {}) });
  const jobs = useApi<{ items: Job[] }>(`/jobs?${params}`);
  const [panel, setPanel] = useState<"none" | "add" | "track">("none");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", company: "", url: "", description: "", location: "" });
  const [careers, setCareers] = useState({ url: "", companyName: "" });
  const [err, setErr] = useState<string | null>(null);

  const setStatus = async (job: Job, status: "saved" | "dismissed" | "applied") => {
    await post(`/jobs/${job.id}/status`, { status });
    toast(status === "dismissed" ? "Hidden from your feed" : status === "saved" ? "Saved to your tracker" : "Logged as applied");
    void jobs.reload();
  };

  const addJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await post("/jobs/import", { ...form, source: "manual", location: form.location || undefined });
      toast("Job added and scored");
      setForm({ title: "", company: "", url: "", description: "", location: "" });
      setPanel("none");
      void jobs.reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  const track = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ ats: { type: string } | null; imported: number; error?: string }>("/jobs/track-careers-page", { url: careers.url, companyName: careers.companyName || undefined });
      toast(r.ats ? `Tracking ${r.ats.type} board: ${r.imported} jobs imported${r.error ? ` (${r.error})` : ""}` : "Saved. We'll check this page during discovery.");
      setPanel("none");
      void jobs.reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle="Every role we found, scored against your profile. Duplicates across sites are merged."
        actions={
          <>
            <Button variant="secondary" onClick={() => setPanel(panel === "track" ? "none" : "track")}>Track a careers page</Button>
            <Button variant="secondary" onClick={() => setPanel(panel === "add" ? "none" : "add")}>Add a job</Button>
          </>
        }
      />

      {panel === "add" && (
        <Card className="mb-6">
          <CardHeader title="Add a job you found" subtitle="From LinkedIn, Wellfound, a referral… We'll score it and track it." />
          <form onSubmit={addJob} className="grid gap-3 p-5 sm:grid-cols-2">
            <Input label="Job title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Input label="Company" required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            <Input label="Link" type="url" required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <Input label="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <div className="sm:col-span-2"><Textarea label="Description" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            {err && <div className="sm:col-span-2"><ErrorNote>{err}</ErrorNote></div>}
            <div className="sm:col-span-2"><Button type="submit" loading={busy}>Add job</Button></div>
          </form>
        </Card>
      )}
      {panel === "track" && (
        <Card className="mb-6">
          <CardHeader title="Track a company's careers page" subtitle="Greenhouse, Lever, Ashby and Workable boards are pulled automatically on every discovery run." />
          <form onSubmit={track} className="grid gap-3 p-5 sm:grid-cols-3">
            <div className="sm:col-span-2"><Input label="Careers page URL" type="url" required placeholder="https://jobs.ashbyhq.com/company" value={careers.url} onChange={(e) => setCareers({ ...careers, url: e.target.value })} /></div>
            <Input label="Company name" value={careers.companyName} onChange={(e) => setCareers({ ...careers, companyName: e.target.value })} />
            {err && <div className="sm:col-span-3"><ErrorNote>{err}</ErrorNote></div>}
            <div className="sm:col-span-3"><Button type="submit" loading={busy}>Track</Button></div>
          </form>
        </Card>
      )}

      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-4">
          <Input placeholder="Search title, company, stack…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
          <Select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} aria-label="Minimum score">
            <option value={0}>Any score</option>
            <option value={50}>Score 50+</option>
            <option value={70}>Score 70+</option>
            <option value={85}>Score 85+</option>
          </Select>
          <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
            <option value="">All sources</option>
            {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} /> Remote only
          </label>
        </div>
        {jobs.loading && !jobs.data ? <Loading /> : jobs.data?.items.length ? (
          <div className="divide-y divide-border">
            {jobs.data.items.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                actions={
                  <>
                    <Button size="sm" variant={j.match?.status === "saved" ? "secondary" : "primary"} onClick={() => setStatus(j, "saved")}>{j.match?.status === "saved" ? "Saved" : "Save"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatus(j, "dismissed")}>Hide</Button>
                  </>
                }
              />
            ))}
          </div>
        ) : (
          <Empty title="No jobs match these filters" body="Try a lower score, or run discovery from the dashboard." />
        )}
      </Card>
    </>
  );
}
