"use client";

import { useState } from "react";
import { RateBars, TimelineChart } from "@/app/components/analytics/Charts";
import { Badge, Button, Card, CardHeader, Loading, PageHeader, pct, Select, Stat, useToast } from "@/app/components/ui";
import { api, errorMessage, post } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";
import type { RateRow } from "@/app/types/api";

interface Overview {
  totals: { sent: number; delivered: number; bounced: number; opened: number; replied: number; positive: number; openRate: number; replyRate: number; positiveRate: number; bounceRate: number };
  byTemplate: RateRow[];
  bySubject: RateRow[];
  byRole: RateRow[];
  byCompanySize: RateRow[];
  byContactRole: RateRow[];
  byTone: RateRow[];
  byStep: RateRow[];
  abTests: { campaignId: string; A?: { sent: number; replies: number }; B?: { sent: number; replies: number }; winner: "A" | "B" | null }[];
  timeline: { date: string; sent: number; replies: number }[];
  insights: { kind: string; text: string; confidence: string }[];
}

const NICE: Record<string, string> = { startup: "Startups", scaleup: "Scale-ups", mnc: "MNCs", unknown: "Unknown size", founder: "Founders", cto: "CTOs / eng leads", hiring_manager: "Hiring managers", recruiter: "Recruiters", engineer: "Engineers", other: "Other", formal: "Formal", casual: "Casual" };
const label = (k: string) => NICE[k] ?? k.replace(/_/g, " ");

export default function AnalyticsPage() {
  const toast = useToast();
  const [days, setDays] = useState(90);
  const { data, loading } = useApi<Overview>(`/analytics/overview?days=${days}`);
  const [advice, setAdvice] = useState<{ title: string; detail: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (!data) return null;
  const t = data.totals;
  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="What's working for you, from your own sends."
        actions={
          <>
            <Select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-36">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </Select>
            <Button variant="secondary" loading={busy === "weekly"} onClick={async () => { setBusy("weekly"); try { await post("/analytics/weekly-report"); toast("Weekly report sent to your notifications"); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(null); } }}>Send weekly report</Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Sent" value={t.sent} hint={`${t.bounced} bounced (${pct(t.bounceRate)})`} />
        <Stat label="Open rate" value={pct(t.openRate)} hint={`${t.opened} opened`} />
        <Stat label="Reply rate" value={pct(t.replyRate)} hint={`${t.replied} replies`} />
        <Stat label="Positive" value={pct(t.positiveRate)} hint="interested, referral, resume" />
        <Stat label="Follow-up replies" value={data.byStep.filter((s) => s.key !== "initial").reduce((a, s) => a + s.replies, 0)} hint="replies to a follow-up" />
      </div>

      {data.insights.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Insights" subtitle="Plain-language findings from your data" />
          <ul className="divide-y divide-border">
            {data.insights.map((i) => (
              <li key={i.text} className="flex items-start gap-3 px-5 py-3 text-sm">
                <Badge tone={i.kind === "warning" ? "warn" : i.kind === "comparison" ? "info" : "brand"}>{i.kind}</Badge>
                <span className="flex-1">{i.text}</span>
                <span className="text-xs text-ink-3">{i.confidence} confidence</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader title="Daily activity" subtitle="Emails sent and replies received" />
        <TimelineChart data={data.timeline} />
      </Card>

      <div className="mb-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card><CardHeader title="Reply rate by company size" /><RateBars rows={data.byCompanySize} label={label} /></Card>
        <Card><CardHeader title="By who you emailed" /><RateBars rows={data.byContactRole} label={label} /></Card>
        <Card><CardHeader title="By role" /><RateBars rows={data.byRole} label={label} /></Card>
        <Card><CardHeader title="By tone" /><RateBars rows={data.byTone} label={label} /></Card>
        <Card><CardHeader title="By sequence step" /><RateBars rows={data.byStep} label={label} /></Card>
        <Card><CardHeader title="By template" /><RateBars rows={data.byTemplate} label={label} /></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Subject lines" subtitle="First emails only" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-3">
                <tr><th className="px-5 py-2 font-medium">Subject</th><th className="px-3 py-2 text-right font-medium">Sent</th><th className="px-3 py-2 text-right font-medium">Opened</th><th className="px-5 py-2 text-right font-medium">Replied</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.bySubject.map((s) => (
                  <tr key={s.key}><td className="max-w-xs truncate px-5 py-2">{s.key}</td><td className="px-3 py-2 text-right tabular-nums">{s.sent}</td><td className="px-3 py-2 text-right tabular-nums">{pct(s.openRate)}</td><td className="px-5 py-2 text-right font-medium tabular-nums">{pct(s.replyRate)}</td></tr>
                ))}
                {data.bySubject.length === 0 && <tr><td colSpan={4} className="px-5 py-6 text-center text-ink-3">No data yet</td></tr>}
              </tbody>
            </table>
          </div>
          {data.abTests.length > 0 && (
            <div className="border-t border-border p-5">
              <p className="mb-2 text-sm font-semibold">A/B subject tests</p>
              {data.abTests.map((a) => (
                <p key={a.campaignId} className="text-sm text-ink-2">
                  A: {a.A ? `${a.A.replies}/${a.A.sent}` : "–"} · B: {a.B ? `${a.B.replies}/${a.B.sent}` : "–"} · {a.winner ? <Badge tone="ok">Variant {a.winner} wins</Badge> : <span className="text-ink-3">no significant winner yet (needs ~20 sends each)</span>}
                </p>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-5">
          <p className="font-semibold">What to change</p>
          <p className="mt-1 text-sm text-ink-3">Suggestions based on your numbers.</p>
          {advice ? (
            <ul className="mt-4 space-y-3">{advice.map((a) => <li key={a.title} className="text-sm"><p className="font-medium">{a.title}</p><p className="text-ink-2">{a.detail}</p></li>)}</ul>
          ) : (
            <Button className="mt-4" loading={busy === "advice"} onClick={async () => { setBusy("advice"); try { setAdvice((await api<{ suggestions: { title: string; detail: string }[] }>("/analytics/advice")).suggestions); } finally { setBusy(null); } }}>Get suggestions</Button>
          )}
        </Card>
      </div>
    </>
  );
}
