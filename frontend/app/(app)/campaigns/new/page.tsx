"use client";

import { COMPANY_SIZES, TONES } from "shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/app/(app)/AppShell";
import { Badge, Button, Card, CardHeader, Chips, ErrorNote, Input, PageHeader, Select } from "@/app/components/ui";
import { api, del, errorMessage, post } from "@/app/services/api";
import type { Campaign } from "@/app/types/api";

export default function NewCampaign() {
  const router = useRouter();
  const { user } = useSession();
  const pro = user.plan !== "free";
  const [f, setF] = useState({
    name: "Startups hiring frontend",
    query: "",
    minScore: 60,
    remoteOnly: false,
    companySizes: [] as string[],
    mode: "approval" as "approval" | "autopilot",
    tone: "casual",
    abTest: false,
    followups: "3, 7, 14",
    startHour: 9,
    endHour: 17,
    preferredHour: 10,
    weekdaysOnly: true,
  });
  const [preview, setPreview] = useState<{ count: number; companies: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const body = () => ({
    name: f.name,
    mode: f.mode,
    tone: f.tone,
    abTest: f.abTest,
    filters: { query: f.query || undefined, minScore: f.minScore, remoteOnly: f.remoteOnly || undefined, companySizes: f.companySizes.length ? f.companySizes : undefined },
    sequence: [{ dayOffset: 0, kind: "initial" }, ...f.followups.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b).map((d) => ({ dayOffset: d, kind: "followup" }))],
    sendWindow: { startHour: f.startHour, endHour: f.endHour, preferredHour: f.preferredHour, weekdaysOnly: f.weekdaysOnly },
  });

  const save = async (launch: boolean) => {
    setBusy(launch ? "launch" : "preview");
    setError(null);
    try {
      const { campaign } = await post<{ campaign: Campaign }>("/campaigns", body());
      if (!launch) {
        setPreview(await api<{ count: number; companies: string[] }>(`/campaigns/${campaign.id}/preview`));
        await del(`/campaigns/${campaign.id}`);
        return;
      }
      await post(`/campaigns/${campaign.id}/launch`);
      router.push(`/campaigns/${campaign.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="New campaign" subtitle="We'll pick one person per company, draft an email for each, and follow up until they reply." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Who to reach" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2"><Input label="Campaign name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <Input label="Keyword (title or description)" placeholder="frontend, intern, React…" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} />
              <Input label={`Minimum match score: ${f.minScore}`} type="range" min={0} max={100} step={5} value={f.minScore} onChange={(e) => setF({ ...f, minScore: Number(e.target.value) })} className="px-0" />
              <div className="sm:col-span-2">
                <p className="mb-2 text-sm font-medium text-ink-2">Company size</p>
                <Chips options={COMPANY_SIZES} value={f.companySizes as never[]} onChange={(v) => setF({ ...f, companySizes: v })} />
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.remoteOnly} onChange={(e) => setF({ ...f, remoteOnly: e.target.checked })} /> Remote roles only</label>
            </div>
          </Card>
          <Card>
            <CardHeader title="How to send" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Select label="Mode" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as "approval" | "autopilot" })}>
                <option value="approval">Approval: I review every email</option>
                <option value="autopilot" disabled={!pro}>Autopilot: send automatically{pro ? "" : " (Pro)"}</option>
              </Select>
              <Select label="Tone" value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })}>
                {TONES.map((t) => <option key={t} value={t}>{t === "founder" ? "Founder-to-founder" : t[0].toUpperCase() + t.slice(1)}</option>)}
              </Select>
              <Input label="Follow up on day" value={f.followups} onChange={(e) => setF({ ...f, followups: e.target.value })} hint="Comma-separated. Stops automatically when they reply." />
              <Input label="Send at (their local hour)" type="number" min={0} max={23} value={f.preferredHour} onChange={(e) => setF({ ...f, preferredHour: Number(e.target.value) })} hint="e.g. 10 for 10 AM in the recipient's time zone" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.weekdaysOnly} onChange={(e) => setF({ ...f, weekdaysOnly: e.target.checked })} /> Weekdays only</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!pro} checked={f.abTest} onChange={(e) => setF({ ...f, abTest: e.target.checked })} /> A/B test subject lines {!pro && <Badge>Pro</Badge>}</label>
            </div>
          </Card>
          {!pro && (
            <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
              Bulk campaigns are a Pro feature. On Free, draft emails one at a time from any job or company page (approval mode, 15 sends a day). Switch plans in Settings.
            </div>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy === "preview"} onClick={() => save(false)}>Preview targets</Button>
            <Button loading={busy === "launch"} onClick={() => save(true)}>{f.mode === "autopilot" ? "Launch on autopilot" : "Create drafts for review"}</Button>
          </div>
        </div>
        <Card className="h-fit p-5">
          <p className="font-semibold">Safety limits</p>
          <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
            <li>• Sends from your own mailbox, never a shared server</li>
            <li>• Daily cap per plan and mailbox, with warm-up for new accounts</li>
            <li>• 1.5–7 minute random gaps between emails</li>
            <li>• Only verified addresses; bounces are suppressed</li>
            <li>• One person per company, never double-emailed</li>
          </ul>
          {preview && (
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-sm font-medium">{preview.count} matching jobs at {preview.companies.length} companies</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{preview.companies.slice(0, 20).map((c) => <Badge key={c}>{c}</Badge>)}</div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
