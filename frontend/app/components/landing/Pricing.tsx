export function Pricing() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 md:px-8">
            <div className="grid gap-4 md:grid-cols-3">
              {[
                { name: "Free", price: "$0", items: ["15 sends / day", "40 AI drafts / month", "Approval mode", "1 mailbox"] },
                { name: "Pro", price: "$12/mo", items: ["80 sends / day", "Autopilot + bulk campaigns", "A/B subject tests", "3 mailboxes, WhatsApp alerts"] },
                { name: "College", price: "Per seat", items: ["Placement-cell dashboard", "Invite codes for students", "Alumni referral finder", "Pro features for every student"] },
              ].map((p) => (
                <div key={p.name} className="rounded-[var(--radius-card)] border border-border bg-surface p-6">
                  <p className="text-sm font-medium text-ink-3">{p.name}</p>
                  <p className="mt-1 text-3xl font-semibold">{p.price}</p>
                  <ul className="mt-4 space-y-2 text-sm text-ink-2">
                    {p.items.map((i) => (
                      <li key={i}>✓ {i}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
  );
}
