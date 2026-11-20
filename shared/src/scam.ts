export interface ScamCheckInput {
  title: string;
  company: string;
  description: string;
  url?: string | null;
  contactEmail?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
}

export interface ScamResult {
  score: number; // 0 (clean) .. 100 (very likely a scam)
  level: "low" | "medium" | "high";
  reasons: string[];
}

const RULES: { re: RegExp; weight: number; reason: string }[] = [
  { re: /\b(registration|training|security|joining|processing|kit) (fee|deposit|charges?)\b/i, weight: 45, reason: "Asks for a fee or deposit" },
  { re: /\b(pay|deposit|transfer)\b[^.]{0,40}\b(before|to (start|join|begin))\b/i, weight: 35, reason: "Asks for payment before starting" },
  { re: /\b(telegram|whatsapp)\b[^.]{0,40}\b(contact|message|reach|interview|hr)\b/i, weight: 25, reason: "Interview or contact only over Telegram/WhatsApp" },
  { re: /\b(gift cards?|crypto(currency)? payment|bitcoin|usdt)\b/i, weight: 30, reason: "Mentions gift cards or crypto payments" },
  { re: /\b(no experience (needed|required)|anyone can apply)\b[^.]{0,80}\b(earn|income|\$\d)/i, weight: 20, reason: "\"No experience\" combined with earnings promises" },
  { re: /\b(earn|make) (up to )?[$₹€£]?\s?\d[\d,]*\s*(\+\s*)?(per|a|\/)\s*(day|week)\b/i, weight: 25, reason: "Promises daily/weekly earnings" },
  { re: /\b(data entry|typing job|form filling|copy paste)\b/i, weight: 15, reason: "Common scam job category (data entry/typing)" },
  { re: /\b(send|share) (your )?(bank|aadhaar|ssn|social security|passport|pan card)\b/i, weight: 40, reason: "Asks for bank or ID documents upfront" },
  { re: /\b(check|cheque)\b[^.]{0,40}\b(deposit|equipment|purchase)\b/i, weight: 35, reason: "Cheque-for-equipment pattern" },
  { re: /\b(urgent(ly)?|immediate) (hiring|joining|requirement)\b.*\b(limited (seats|slots))\b/i, weight: 15, reason: "High-pressure urgency" },
  { re: /\b(mlm|multi[- ]level marketing|network marketing|refer (and|&) earn)\b/i, weight: 30, reason: "Multi-level marketing" },
];

const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|rediffmail|proton(mail)?|aol|icloud|ymail)\.(com|in|me)$/i;
const SHORTENER = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|rb\.gy|forms\.gle)\b/i;

export function detectScam(job: ScamCheckInput): ScamResult {
  const text = `${job.title}\n${job.description}`;
  const reasons: string[] = [];
  let score = 0;
  for (const r of RULES) {
    if (r.re.test(text)) {
      score += r.weight;
      reasons.push(r.reason);
    }
  }
  const emails = [...(job.contactEmail ? [job.contactEmail] : []), ...(text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [])];
  if (emails.some((e) => FREE_MAIL.test(e)) && !/freelance|personal project/i.test(text)) {
    score += 20;
    reasons.push("Recruiter uses a free email address instead of a company domain");
  }
  if ((job.url && SHORTENER.test(job.url)) || SHORTENER.test(text)) {
    score += 10;
    reasons.push("Uses link shorteners or generic forms");
  }
  if (job.description.trim().length < 120) {
    score += 10;
    reasons.push("Very short description with few details");
  }
  // Unrealistic pay: > $400k/yr or ₹1cr+ for junior / intern titles
  const max = job.salaryMax ?? job.salaryMin ?? 0;
  if (/\b(intern|junior|entry|fresher|trainee)\b/i.test(job.title)) {
    if ((job.currency === "USD" && max > 250_000) || (job.currency === "INR" && max > 5_000_000)) {
      score += 25;
      reasons.push("Pay is unrealistically high for the level");
    }
  }
  if (!job.company || /^(confidential|hidden|n\/a|unknown)$/i.test(job.company.trim())) {
    score += 10;
    reasons.push("Company name is hidden");
  }
  score = Math.min(100, score);
  return { score, level: score >= 50 ? "high" : score >= 25 ? "medium" : "low", reasons };
}
