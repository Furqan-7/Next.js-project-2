import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/app/components/ui";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: { default: "JobPilot: AI job search on autopilot", template: "%s · JobPilot" },
  description: "Find matching jobs, the right person to email, and send personalised outreach from your own inbox.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f766e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
