const FEATURES = [
  { title: "Jobs that fit you", body: "Greenhouse, Lever, Ashby, Workable, YC, HN Who's Hiring, Remotive and RemoteOK in one feed, deduplicated, scam-checked and scored 0–100 against your profile with the reasons." },
  { title: "The right person, verified", body: "Finds founders, CTOs, hiring managers and recruiters, learns each company's email pattern, and checks MX/SMTP before anything is sent." },
  { title: "Emails that sound like you", body: "Each draft opens with something specific about them and ties your best-matching project to their product. Three tones, 3–5 subject lines, spam check." },
  { title: "Your inbox, your rules", body: "Sends from your own Gmail or Outlook at 10 AM their time, with day 3 / 7 / 14 follow-ups that stop the moment someone replies." },
  { title: "Replies, sorted", body: "Interested, referral, asked for resume, out-of-office, rejected. Each comes with a suggested reply and a booking link." },
  { title: "Tracker to offer", body: "A kanban from Found to Offer, notes and reminders, and an interview prep pack built from your real projects." },
];

export function Features() {
  return (
    <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:grid-cols-2 md:px-8 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{f.body}</p>
              </div>
            ))}
          </section>
  );
}
