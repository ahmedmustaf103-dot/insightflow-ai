"use client";

import { useState } from "react";
import type { PublicErrorBody } from "@/lib/api/error-body";
import type { AnalysisResponse, DatasetProfile } from "@/lib/analysis/types";
import { AnalysisLoading } from "@/components/analysis-loading";
import { AnswerView } from "@/components/answer-view";
import { DatasetSummary } from "@/components/dataset-summary";
import { DatasetUpload } from "@/components/dataset-upload";
import { ErrorNotice } from "@/components/error-notice";
import { QuestionForm } from "@/components/question-form";

export function Workspace({
  uploadFile,
  askQuestion = askDatasetQuestion,
}: {
  uploadFile?: (file: File, onProgress: (percent: number) => void) => Promise<DatasetProfile>;
  askQuestion?: (datasetId: string, question: string) => Promise<AnalysisResponse>;
}) {
  const [profile, setProfile] = useState<DatasetProfile | null>(null);
  const [response, setResponse] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<PublicErrorBody["error"] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

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
    <div className="min-h-screen">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-6">
          <p className="text-sm font-semibold tracking-tight">InsightFlow AI</p>
          <p className="hidden text-sm text-muted sm:block">Evidence-backed analysis</p>
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-10 sm:px-6 sm:py-14">
        {profile ? null : (
          <div className="max-w-2xl">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Ask questions about your business data.</h1>
            <p className="mt-4 text-lg leading-8 text-muted">
              Upload a CSV. InsightFlow plans the analysis, calculates the result, and shows the evidence.
            </p>
          </div>
        )}

        {profile ? (
          <DatasetSummary profile={profile} />
        ) : (
          <DatasetUpload
            uploadFile={uploadFile}
            onUploaded={(next) => {
              setProfile(next);
              setResponse(null);
              setError(null);
            }}
          />
        )}

        {profile ? (
          <>
            <QuestionForm disabled={analyzing} onSubmit={(question) => void onAsk(question)} />
            <div className="flex justify-start">
              <button
                type="button"
                disabled={analyzing}
                onClick={() => {
                  setProfile(null);
                  setResponse(null);
                  setError(null);
                }}
                className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-40"
              >
                Upload a different CSV
              </button>
            </div>
          </>
        ) : null}

        {analyzing ? <AnalysisLoading /> : null}
        {error ? <ErrorNotice error={error} /> : null}
        {response ? <AnswerView response={response} /> : null}
      </main>
    </div>
  );
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
