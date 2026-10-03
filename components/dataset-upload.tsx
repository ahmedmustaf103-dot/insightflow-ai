"use client";

import { useId, useState } from "react";
import type { DatasetProfile } from "@/lib/analysis/types";
import { formatMegabytes, rejectUpload } from "@/lib/datasets/file-rules";
import { DEFAULT_LIMITS } from "@/lib/analysis/limits";
import type { PublicErrorBody } from "@/lib/api/error-body";

type UploadPhase = "idle" | "uploading" | "reading";

export function DatasetUpload({
  disabled = false,
  onUploaded,
  uploadFile = uploadDatasetFile,
}: {
  disabled?: boolean;
  onUploaded: (profile: DatasetProfile) => void;
  uploadFile?: (file: File, onProgress: (percent: number) => void) => Promise<DatasetProfile>;
}) {
  const inputId = useId();
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<PublicErrorBody["error"] | null>(null);

  async function accept(file: File | undefined) {
    if (!file || disabled || phase !== "idle") return;
    const rejection = rejectUpload({ name: file.name, size: file.size });
    if (rejection) {
      setError({ title: "Unsupported file", message: rejection.message });
      return;
    }

    setError(null);
    setProgress(0);
    setPhase("uploading");
    try {
      const profile = await uploadFile(file, (percent) => {
        setProgress(percent);
        if (percent >= 100) setPhase("reading");
      });
      onUploaded(profile);
      setPhase("idle");
    } catch (caught) {
      setPhase("idle");
      setError(readError(caught));
    }
  }

  const busy = phase !== "idle";

  return (
    <div className="space-y-3">
      <label
        htmlFor={inputId}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled && !busy) setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled && !busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void accept(event.dataTransfer.files[0]);
        }}
        className={`flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition ${
          dragOver ? "border-accent bg-white" : "border-line bg-card"
        } ${disabled || busy ? "cursor-default opacity-70" : "hover:border-accent"}`}
      >
        <input
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void accept(file);
          }}
        />
        <span className="text-lg font-medium text-ink">
          {phase === "uploading" ? `Uploading ${progress}%` : phase === "reading" ? "Reading your dataset" : "Upload your CSV"}
        </span>
        <span className="mt-2 max-w-sm text-sm leading-6 text-muted">
          {busy ? "Checking columns, types, and data quality." : "Drag and drop a file here, or browse."}
        </span>
      </label>
      <p className="text-sm text-muted">Supported: CSV · up to {formatMegabytes(DEFAULT_LIMITS.maxUploadBytes)}</p>
      {error ? (
        <div role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
          <p className="font-medium">{error.title}</p>
          <p className="mt-1">{error.message}</p>
        </div>
      ) : null}
    </div>
  );
}

async function uploadDatasetFile(file: File, onProgress: (percent: number) => void): Promise<DatasetProfile> {
  const body = new FormData();
  body.set("file", file);

  const payload = await new Promise<unknown>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/datasets");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.upload.onload = () => onProgress(100);
    request.onload = () => {
      try {
        resolve(JSON.parse(request.responseText) as unknown);
      } catch {
        reject(new Error("upload_failed"));
      }
    };
    request.onerror = () => reject(new Error("upload_failed"));
    request.send(body);
  });

  if (!isProfile(payload)) {
    if (isPublicError(payload)) {
      throw payload;
    }
    throw new Error("upload_failed");
  }
  return payload;
}

function isProfile(value: unknown): value is DatasetProfile {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.datasetId === "string" && Array.isArray(record.columns) && typeof record.rowCount === "number";
}

function isPublicError(value: unknown): value is PublicErrorBody {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error?: { title?: unknown; message?: unknown } }).error;
  return typeof error?.title === "string" && typeof error.message === "string";
}

function readError(error: unknown): PublicErrorBody["error"] {
  if (isPublicError(error)) return error.error;
  return {
    title: "Upload failed",
    message: "The file could not be uploaded. Try again.",
  };
}
