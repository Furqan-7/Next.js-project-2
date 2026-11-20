export interface OutreachRecord {
  sentAt: Date;
  opened: boolean;
  replied: boolean;
  positive: boolean; // interested / asked for resume / referral
  bounced: boolean;
  templateKey: string;
  subject: string;
  tone: string;
  role: string; // target role of the job
  companySize: string; // startup | scaleup | mnc | unknown
  contactRole: string; // founder | recruiter | ...
  step: number; // 0 = initial, 1.. = follow-ups
}

export interface RateRow {
  key: string;
  sent: number;
  opens: number;
  replies: number;
  positive: number;
  openRate: number;
  replyRate: number;
}

export function groupRates(records: OutreachRecord[], keyFn: (r: OutreachRecord) => string): RateRow[] {
  const m = new Map<string, RateRow>();
  for (const r of records) {
    if (r.bounced) continue;
    const key = keyFn(r) || "unknown";
    const row = m.get(key) ?? { key, sent: 0, opens: 0, replies: 0, positive: 0, openRate: 0, replyRate: 0 };
    row.sent++;
    if (r.opened) row.opens++;
    if (r.replied) row.replies++;
    if (r.positive) row.positive++;
    m.set(key, row);
  }
  return [...m.values()]
    .map((r) => ({ ...r, openRate: r.sent ? r.opens / r.sent : 0, replyRate: r.sent ? r.replies / r.sent : 0 }))
    .sort((a, b) => b.replyRate - a.replyRate || b.sent - a.sent);
}

export interface Insight {
  kind: "comparison" | "suggestion" | "warning";
  text: string;
  confidence: "low" | "medium" | "high";
}

function conf(n: number): Insight["confidence"] {
  return n >= 60 ? "high" : n >= 20 ? "medium" : "low";
}

const LABELS: Record<string, string> = {
  startup: "startups",
  scaleup: "scale-ups",
  mnc: "MNCs",
  founder: "founders",
  cto: "CTOs",
  recruiter: "recruiters",
  hiring_manager: "hiring managers",
  engineer: "engineers",
  formal: "formal tone",
  casual: "casual tone",
  founder_tone: "founder-to-founder tone",
};

/** Plain-language findings like "Startups reply 3× more than MNCs for you". */
export function computeInsights(records: OutreachRecord[], minSample = 8): Insight[] {
  const out: Insight[] = [];
  const compare = (rows: RateRow[], noun: string) => {
    const usable = rows.filter((r) => r.sent >= minSample);
    if (usable.length < 2) return;
    const best = usable[0];
    const worst = usable[usable.length - 1];
    if (best.replyRate === 0) return;
    const ratio = worst.replyRate === 0 ? null : best.replyRate / worst.replyRate;
    const bl = LABELS[best.key] ?? best.key;
    const wl = LABELS[worst.key] ?? worst.key;
    if (ratio === null) {
      out.push({ kind: "comparison", text: `${cap(bl)} reply to you (${pct(best.replyRate)}); ${wl} haven't replied yet across ${worst.sent} emails.`, confidence: conf(best.sent + worst.sent) });
    } else if (ratio >= 1.5) {
      out.push({ kind: "comparison", text: `${cap(bl)} reply ${ratio.toFixed(1)}× more than ${wl} for you (${pct(best.replyRate)} vs ${pct(worst.replyRate)}).`, confidence: conf(best.sent + worst.sent) });
    }
    void noun;
  };
  compare(groupRates(records, (r) => r.companySize), "company size");
  compare(groupRates(records, (r) => r.contactRole), "contact role");
  compare(groupRates(records, (r) => (r.tone === "founder" ? "founder_tone" : r.tone)), "tone");
  compare(groupRates(records, (r) => r.role), "role");

  const subjects = groupRates(records.filter((r) => r.step === 0), (r) => r.subject).filter((r) => r.sent >= Math.max(3, Math.floor(minSample / 2)));
  if (subjects.length >= 2 && subjects[0].replyRate > 0) {
    out.push({ kind: "suggestion", text: `Your best subject line so far is "${subjects[0].key}" (${pct(subjects[0].replyRate)} reply rate). Reuse its structure.`, confidence: conf(subjects[0].sent) });
  }

  const followups = records.filter((r) => r.step > 0 && !r.bounced);
  const repliesFromFollowups = followups.filter((r) => r.replied).length;
  const totalReplies = records.filter((r) => r.replied).length;
  if (totalReplies >= 3 && repliesFromFollowups / totalReplies >= 0.3) {
    out.push({ kind: "suggestion", text: `${pct(repliesFromFollowups / totalReplies)} of your replies came from follow-ups. Keep sequences on.`, confidence: conf(totalReplies * 5) });
  }

  const sent = records.length;
  const bounced = records.filter((r) => r.bounced).length;
  if (sent >= 20 && bounced / sent > 0.05) {
    out.push({ kind: "warning", text: `Bounce rate is ${pct(bounced / sent)}. Verify addresses before sending to protect your inbox.`, confidence: "high" });
  }
  const opens = records.filter((r) => r.opened).length;
  if (sent >= 30 && opens / sent < 0.2) {
    out.push({ kind: "warning", text: `Only ${pct(opens / sent)} of emails are opened. Check deliverability (SPF/DKIM/DMARC) and try shorter, more specific subjects.`, confidence: "medium" });
  }

  // Best hour
  const byHour = groupRates(records, (r) => String(r.sentAt.getUTCHours()));
  const goodHour = byHour.find((r) => r.sent >= minSample);
  if (goodHour && goodHour.replyRate > 0) {
    out.push({ kind: "suggestion", text: `Emails sent around ${goodHour.key}:00 UTC get the most replies (${pct(goodHour.replyRate)}).`, confidence: conf(goodHour.sent) });
  }
  return out;
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}
function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Simple two-proportion z-test to decide whether an A/B subject variant is a winner. */
export function abWinner(a: { sent: number; replies: number }, b: { sent: number; replies: number }, minSent = 20): "A" | "B" | null {
  if (a.sent < minSent || b.sent < minSent) return null;
  const pa = a.replies / a.sent;
  const pb = b.replies / b.sent;
  const p = (a.replies + b.replies) / (a.sent + b.sent);
  const se = Math.sqrt(p * (1 - p) * (1 / a.sent + 1 / b.sent));
  if (se === 0) return null;
  const z = (pa - pb) / se;
  if (z > 1.64) return "A";
  if (z < -1.64) return "B";
  return null;
}
