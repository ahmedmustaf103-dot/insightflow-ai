import type { AnalysisResult } from "@/lib/analysis/types";

export type OverviewTone = "amber" | "blue" | "violet" | "teal";

export type OverviewCard = {
  label: string;
  value: string;
  detail?: string;
  positive?: boolean;
  tone: OverviewTone;
};

export type DashboardOverview = {
  cards: OverviewCard[];
  trend: {
    title: string;
    period: string;
    total: string;
    delta?: string;
    positive?: boolean;
    measure: string;
    result: AnalysisResult;
  } | null;
  ranking: {
    title: string;
    period: string;
    result: AnalysisResult;
  } | null;
};
