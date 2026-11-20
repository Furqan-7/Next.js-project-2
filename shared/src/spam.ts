/** Words and phrases that commonly trip spam filters in cold outreach. */
export const SPAM_TRIGGERS: { phrase: string; weight: number; suggestion?: string }[] = [
  { phrase: "free", weight: 2, suggestion: "no cost" },
  { phrase: "guarantee", weight: 3, suggestion: "I'm confident" },
  { phrase: "guaranteed", weight: 3, suggestion: "reliably" },
  { phrase: "act now", weight: 4 },
  { phrase: "urgent", weight: 3 },
  { phrase: "limited time", weight: 4 },
  { phrase: "click here", weight: 4, suggestion: "here's the link" },
  { phrase: "click below", weight: 3 },
  { phrase: "100%", weight: 3 },
  { phrase: "risk-free", weight: 4 },
  { phrase: "no obligation", weight: 3 },
  { phrase: "winner", weight: 3 },
  { phrase: "congratulations", weight: 2 },
  { phrase: "earn money", weight: 5 },
  { phrase: "make money", weight: 5 },
  { phrase: "cash", weight: 2 },
  { phrase: "$$$", weight: 5 },
  { phrase: "cheap", weight: 2 },
  { phrase: "discount", weight: 2 },
  { phrase: "buy now", weight: 4 },
  { phrase: "order now", weight: 4 },
  { phrase: "special promotion", weight: 4 },
  { phrase: "dear friend", weight: 3, suggestion: "use their name" },
  { phrase: "to whom it may concern", weight: 2, suggestion: "use their name" },
  { phrase: "once in a lifetime", weight: 4 },
  { phrase: "amazing", weight: 1 },
  { phrase: "incredible", weight: 1 },
  { phrase: "unsubscribe", weight: 1 },
  { phrase: "opportunity", weight: 1 },
  { phrase: "increase sales", weight: 3 },
  { phrase: "double your", weight: 4 },
  { phrase: "no cost", weight: 1 },
  { phrase: "apply now", weight: 2 },
  { phrase: "don't delete", weight: 4 },
  { phrase: "this isn't spam", weight: 5 },
  { phrase: "not spam", weight: 5 },
];

export interface SpamCheckResult {
  score: number; // 0..100, higher = more likely to be filtered
  level: "good" | "ok" | "risky";
  hits: { phrase: string; count: number; suggestion?: string }[];
  issues: string[];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function checkSpam(subject: string, body: string): SpamCheckResult {
  const text = `${subject}\n${body}`;
  const lower = text.toLowerCase();
  const hits: SpamCheckResult["hits"] = [];
  let score = 0;
  for (const t of SPAM_TRIGGERS) {
    const re = new RegExp(`(^|[^a-z])${escapeRe(t.phrase)}(?![a-z])`, "g");
    const count = (lower.match(re) ?? []).length;
    if (count) {
      hits.push({ phrase: t.phrase, count, suggestion: t.suggestion });
      score += t.weight * count * 3;
    }
  }
  const issues: string[] = [];
  const letters = subject.replace(/[^A-Za-z]/g, "");
  if (letters.length > 6 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6) {
    score += 15;
    issues.push("Subject is mostly CAPITAL LETTERS");
  }
  const exclam = (text.match(/!/g) ?? []).length;
  if (exclam > 2) {
    score += exclam * 3;
    issues.push(`${exclam} exclamation marks`);
  }
  const links = (body.match(/https?:\/\//g) ?? []).length;
  if (links > 3) {
    score += (links - 3) * 6;
    issues.push(`${links} links (keep it to 1–2 in a cold email)`);
  }
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words > 220) {
    score += 10;
    issues.push(`${words} words; cold emails under 150 words get more replies`);
  }
  if (subject.length > 70) {
    score += 5;
    issues.push("Subject is longer than 70 characters");
  }
  if (/[$₹€£]\s?\d/.test(subject)) {
    score += 8;
    issues.push("Money amount in the subject");
  }
  score = Math.min(100, score);
  return { score, level: score < 15 ? "good" : score < 40 ? "ok" : "risky", hits, issues };
}
