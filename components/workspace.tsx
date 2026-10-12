"use client";

import { useEffect, useState } from "react";
import type { PublicErrorBody } from "@/lib/api/error-body";
import type { AnalysisResponse, DatasetProfile } from "@/lib/analysis/types";
import type { DashboardOverview } from "@/lib/datasets/overview-types";
import { presentWarning } from "@/lib/analysis/present";
import { AnswerView } from "@/components/answer-view";
import { AskPanel } from "@/components/ask-panel";
import { Dashboard, MetricRow } from "@/components/dashboard";
import { DatasetSummary } from "@/components/dataset-summary";
import { DatasetUpload } from "@/components/dataset-upload";
import { ErrorNotice } from "@/components/error-notice";
import { Sidebar } from "@/components/sidebar";

export function Workspace({
  uploadFile,
  loadSample,
  loadOverview = loadDatasetOverview,
  askQuestion = askDatasetQuestion,
}: {
  uploadFile?: (file: File, onProgress: (percent: number) => void) => Promise<DatasetProfile>;
  loadSample?: () => Promise<DatasetProfile>;
  loadOverview?: (datasetId: string) => Promise<DashboardOverview | null>;
  askQuestion?: (datasetId: string, question: string) => Promise<AnalysisResponse>;
}) {
  const [profile, setProfile] = useState<DatasetProfile | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [response, setResponse] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<PublicErrorBody["error"] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void loadOverview(profile.datasetId)
      .then((next) => {
        if (!cancelled) setOverview(next);
      })
      .catch(() => {
        if (!cancelled) setOverview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [profile, loadOverview]);

  function clearDataset() {
    setProfile(null);
    setOverview(null);
    setResponse(null);
    setError(null);
  }

  async function onAsk(question: string) {
    if (!profile) return;
    setAnalyzing(true);
    setError(null);
    setResponse(null);
    try {
      setResponse(await askQuestion(profile.datasetId, question));
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper lg:flex lg:h-screen lg:overflow-hidden">
      <Sidebar
        hasDataset={profile !== null}
        onUploadDifferent={clearDataset}
        onAsk={() => document.getElementById("question")?.focus()}
      />
      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <main className="min-w-0 flex-1 overflow-y-auto px-5 py-6 lg:px-8 lg:py-8">
          {profile ? null : (
            <div className="mb-6 max-w-2xl">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Ask questions about your business data.</h1>
              <p className="mt-4 text-lg leading-8 text-muted">
                Upload a CSV, or try the sample sales data. InsightFlow plans the analysis, calculates the result, and shows the evidence.
              </p>
            </div>
          )}

          {profile && overview ? (
            <header className="mb-5">
              <h2 className="text-2xl font-semibold tracking-tight">{profile.fileName}</h2>
              <p className="mt-1 text-sm text-muted">
                {profile.rowCount.toLocaleString("en-GB")} rows · {profile.columns.length} columns
              </p>
            </header>
          ) : null}

          {profile ? null : (
            <DatasetUpload
              uploadFile={uploadFile}
              loadSample={loadSample}
              onUploaded={(next) => {
                setProfile(next);
                setOverview(null);
                setResponse(null);
                setError(null);
              }}
            />
          )}

          {profile && overview ? (
            <div className="flex flex-col gap-5">
              {profile.warnings.length > 0 ? (
                <details className="rounded-2xl bg-warning-bg px-4 py-2 text-sm text-warning">
                  <summary className="cursor-pointer">
                    {profile.warnings.length} data quality {profile.warnings.length === 1 ? "note" : "notes"}
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {profile.warnings.map((warning) => (
                      <li key={warning}>{presentWarning(warning)}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <MetricRow cards={overview.cards} />
              {response ? <AnswerView response={response} narrative={false} /> : <Dashboard overview={overview} />}
            </div>
          ) : null}

          {profile && !overview ? <DatasetSummary profile={profile} /> : null}
          {profile && !overview && response ? (
            <div className="mt-5">
              <AnswerView response={response} narrative={false} />
            </div>
          ) : null}

          {error ? (
            <div className="mt-5">
              <ErrorNotice error={error} />
            </div>
          ) : null}
        </main>
        <AskPanel
          disabled={analyzing || !profile}
          analyzing={analyzing}
          answer={response?.answer ?? null}
          onSubmit={(question) => void onAsk(question)}
          onEndChat={() => {
            setResponse(null);
            setError(null);
          }}
        />
      </div>
    </div>
  );
}

async function loadDatasetOverview(datasetId: string): Promise<DashboardOverview | null> {
  const response = await fetch(`/api/datasets/${datasetId}/overview`);
  if (!response.ok) return null;
  return (await response.json()) as DashboardOverview;
}

async function askDatasetQuestion(datasetId: string, question: string): Promise<AnalysisResponse> {
  const response = await fetch(`/api/datasets/${datasetId}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    if (isPublicError(payload)) throw payload;
    throw new Error("ask_failed");
  }
  return payload as AnalysisResponse;
}

function isPublicError(value: unknown): value is PublicErrorBody {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error?: { title?: unknown; message?: unknown } }).error;
  return typeof error?.title === "string" && typeof error.message === "string";
}

function readError(error: unknown): PublicErrorBody["error"] {
  if (isPublicError(error)) return error.error;
  return {
    title: "InsightFlow couldn't create an analysis plan.",
    message: "Please try the question again.",
  };
}
