import type { ReplyCategory } from "./types";

const RULES: { category: ReplyCategory; re: RegExp; weight: number }[] = [
  { category: "out_of_office", re: /\b(out of (the )?office|ooo|on (annual |parental |sick )?leave|on vacation|away until|limited access to (my )?email|auto(matic)?[- ]?reply|currently travelling)\b/i, weight: 5 },
  { category: "asked_for_resume", re: /\b(send|share|attach|forward)\b[^.?!]{0,30}\b(resume|cv|portfolio|profile)\b|\b(resume|cv)\b[^.?!]{0,20}\?/i, weight: 4 },
  { category: "referral", re: /\b(reach out to|contact|talk to|loop(ing)? in|cc'?(ing|d)?|forward(ed|ing)? (this|you) to|the right person|better person|introduc(e|ing) you)\b/i, weight: 3 },
  { category: "rejected", re: /\b(not (currently )?hiring|no (open )?(roles|positions|openings)|position (has been|is) filled|not a (good )?fit|decided to (move|go) (forward|ahead) with|unfortunately|won'?t be (moving|able)|regret to|we('| a)re not looking|keep your (details|resume|profile) on file|pass on this)\b/i, weight: 4 },
  { category: "interested", re: /\b(would love to|happy to (chat|talk|connect)|let'?s (chat|talk|connect|set up|schedule)|are you (free|available)|what('?s| is) your availability|book a (time|call|slot)|schedule a (call|chat|time)|calendly|cal\.com|next (week|steps)|interview|sounds (great|interesting|good)|interested|jump on a call|hop on a call)\b/i, weight: 3 },
];

export interface ClassifiedReply {
  category: ReplyCategory;
  confidence: number;
  asksForAvailability: boolean;
  scores: Partial<Record<ReplyCategory, number>>;
}

/** Strip quoted history ("On Tue, X wrote:" and lines starting with ">"). */
export function stripQuoted(body: string): string {
  const cut = body.split(/\n(?:On .{5,120} wrote:|-{2,} ?Original Message ?-{2,}|From: .+\nSent: )/i)[0];
  return cut
    .split("\n")
    .filter((l) => !l.trim().startsWith(">"))
    .join("\n")
    .trim();
}

export function classifyReplyHeuristic(subject: string, body: string): ClassifiedReply {
  const text = `${subject}\n${stripQuoted(body)}`;
  const scores: Partial<Record<ReplyCategory, number>> = {};
  for (const r of RULES) {
    const matches = text.match(new RegExp(r.re.source, "gi"))?.length ?? 0;
    if (matches) scores[r.category] = (scores[r.category] ?? 0) + r.weight * Math.min(matches, 3);
  }
  if (/^(auto|automatic)/i.test(subject) || /out of office/i.test(subject)) scores.out_of_office = (scores.out_of_office ?? 0) + 10;
  // "Unfortunately … but feel free to reach out to X" → referral beats rejected
  if (scores.referral && scores.rejected && /\b[\w.+-]+@[\w-]+\.\w+/.test(text)) scores.referral += 4;
  // "interested" + "send your resume" → resume request is the actionable bit
  if (scores.asked_for_resume && scores.interested) scores.asked_for_resume += 2;
  const ranked = (Object.entries(scores) as [ReplyCategory, number][]).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  const asksForAvailability = /\b(availability|available|free (to|for|on|this|next)|time(s)? (that )?work|when (are|would) you|schedule|book a)\b/i.test(text);
  if (!ranked.length) return { category: "other", confidence: 0.3, asksForAvailability, scores };
  const [category, top] = ranked[0];
  return { category, confidence: Number(Math.min(0.95, 0.45 + (top / total) * 0.5).toFixed(2)), asksForAvailability, scores };
}
