/**
 * Warm-up ramp for new mailboxes: start low and grow ~20%/day until the configured limit.
 * Day 0 = the day warm-up started.
 */
export function warmupLimit(daysSinceStart: number, targetLimit: number, startLimit = 5): number {
  if (daysSinceStart < 0) return startLimit;
  const ramp = Math.round(startLimit * Math.pow(1.2, daysSinceStart));
  return Math.min(targetLimit, ramp);
}

export function effectiveDailyLimit(opts: {
  planLimit: number;
  accountLimit: number;
  warmupEnabled: boolean;
  warmupStartedAt?: Date | null;
  now?: Date;
  healthScore?: number;
}): number {
  const now = opts.now ?? new Date();
  let limit = Math.min(opts.planLimit, opts.accountLimit);
  if (opts.warmupEnabled && opts.warmupStartedAt) {
    const days = Math.floor((now.getTime() - opts.warmupStartedAt.getTime()) / 86400000);
    limit = Math.min(limit, warmupLimit(days, limit));
  }
  // Protect unhealthy inboxes automatically.
  if (opts.healthScore != null) {
    if (opts.healthScore < 40) limit = Math.min(limit, 5);
    else if (opts.healthScore < 60) limit = Math.floor(limit * 0.5);
  }
  return Math.max(0, limit);
}

/** Random gap between consecutive sends from one mailbox (seconds). */
export function randomGapSeconds(min = 90, max = 420, rand: () => number = Math.random): number {
  return Math.round(min + rand() * (max - min));
}

/**
 * Spread `count` sends across a window starting at `start`, with random gaps,
 * never closer than `minGap` seconds.
 */
export function spreadSends(start: Date, count: number, minGap = 90, maxGap = 420, rand: () => number = Math.random): Date[] {
  const out: Date[] = [];
  let t = start.getTime();
  for (let i = 0; i < count; i++) {
    if (i > 0) t += randomGapSeconds(minGap, maxGap, rand) * 1000;
    out.push(new Date(t));
  }
  return out;
}

/** Inbox health score (0–100) from recent sending stats. */
export function inboxHealthScore(s: {
  sent: number;
  bounced: number;
  replies: number;
  spamReports?: number;
  spfOk?: boolean;
  dkimOk?: boolean;
  dmarcOk?: boolean;
  spamPlacementRate?: number; // 0..1 from placement tests
}): { score: number; factors: { label: string; impact: number }[] } {
  const factors: { label: string; impact: number }[] = [];
  let score = 100;
  const add = (label: string, impact: number) => {
    if (impact !== 0) factors.push({ label, impact });
    score += impact;
  };
  if (s.spfOk === false) add("SPF record missing or failing", -15);
  if (s.dkimOk === false) add("DKIM not configured", -15);
  if (s.dmarcOk === false) add("No DMARC policy", -10);
  if (s.sent >= 10) {
    const bounceRate = s.bounced / s.sent;
    if (bounceRate > 0.08) add(`High bounce rate (${(bounceRate * 100).toFixed(1)}%)`, -30);
    else if (bounceRate > 0.03) add(`Elevated bounce rate (${(bounceRate * 100).toFixed(1)}%)`, -12);
    const replyRate = s.replies / s.sent;
    if (replyRate >= 0.1) add(`Healthy reply rate (${(replyRate * 100).toFixed(0)}%)`, +5);
    else if (replyRate < 0.01 && s.sent > 50) add("Almost no replies; content may be landing in spam", -10);
  }
  if (s.spamReports) add(`${s.spamReports} spam complaint(s)`, -20 * Math.min(3, s.spamReports));
  if (s.spamPlacementRate != null) {
    if (s.spamPlacementRate > 0.3) add(`${Math.round(s.spamPlacementRate * 100)}% of test emails landed in spam`, -25);
    else if (s.spamPlacementRate > 0.1) add(`${Math.round(s.spamPlacementRate * 100)}% of test emails landed in spam`, -10);
  }
  return { score: Math.max(0, Math.min(100, score)), factors };
}
