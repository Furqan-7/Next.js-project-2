import type { Plan } from "./types";

export interface PlanLimits {
  label: string;
  priceMonthlyUsd: number;
  dailySends: number;
  monthlyAiDrafts: number;
  mailboxes: number;
  autopilot: boolean;
  bulkCampaigns: boolean;
  abTesting: boolean;
  emailVerificationsPerMonth: number;
  whatsappNotifications: boolean;
  seats?: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    label: "Free",
    priceMonthlyUsd: 0,
    dailySends: 15,
    monthlyAiDrafts: 40,
    mailboxes: 1,
    autopilot: false,
    bulkCampaigns: false,
    abTesting: false,
    emailVerificationsPerMonth: 50,
    whatsappNotifications: false,
  },
  pro: {
    label: "Pro",
    priceMonthlyUsd: 12,
    dailySends: 80,
    monthlyAiDrafts: 1500,
    mailboxes: 3,
    autopilot: true,
    bulkCampaigns: true,
    abTesting: true,
    emailVerificationsPerMonth: 2000,
    whatsappNotifications: true,
  },
  college: {
    label: "College",
    priceMonthlyUsd: 0, // billed per seat to the institution
    dailySends: 60,
    monthlyAiDrafts: 1000,
    mailboxes: 2,
    autopilot: true,
    bulkCampaigns: true,
    abTesting: true,
    emailVerificationsPerMonth: 1000,
    whatsappNotifications: true,
    seats: 500,
  },
};

export type Feature = "autopilot" | "bulkCampaigns" | "abTesting" | "whatsappNotifications";

export function planAllows(plan: Plan, feature: Feature): boolean {
  return Boolean(PLAN_LIMITS[plan][feature]);
}
