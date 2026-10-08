import { AnalysisFailure } from "@/lib/analysis/errors";
import type { PublicErrorBody } from "@/lib/api/error-body";
import { DatasetNotFoundError } from "@/lib/datasets/store";

export type { PublicErrorBody } from "@/lib/api/error-body";

export function toPublicError(error: unknown): { status: number; body: PublicErrorBody } {
  if (error instanceof DatasetNotFoundError) {
    return {
      status: 404,
      body: {
        error: {
          title: "Dataset not found",
          message: "Upload the CSV again to continue.",
        },
      },
    };
  }

  if (error instanceof AnalysisFailure) {
    return {
      status: statusFor(error),
      body: { error: { ...messageFor(error), stage: error.error.stage } },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        title: "Something went wrong",
        message: "Please try again.",
      },
    },
  };
}

export function logServerError(error: unknown): void {
  if (error instanceof DatasetNotFoundError) {
    return;
  }
  if (error instanceof AnalysisFailure) {
    console.error("analysis_failed", {
      stage: error.error.stage,
      message: error.error.message,
      details: error.error.details,
    });
    return;
  }
  console.error("request_failed", error);
}

function statusFor(error: AnalysisFailure): number {
  const code = detailCode(error);
  if (code === "upload_limit") return 413;
  if (error.error.stage === "profile" && (code === "invalid_file" || code === "empty_file")) return 400;
  if (error.error.stage === "profile") return 422;
  return 400;
}

function messageFor(error: AnalysisFailure): PublicErrorBody["error"] {
  const code = detailCode(error);
  const column = detailColumn(error);

  if (code === "unknown_column" && column) {
    return {
      title: "We couldn't analyse that question.",
      message: `The requested column "${column}" isn't present in this dataset.`,
    };
  }

  if (code === "unsupported_request") {
    const role = detailString(error, "role");
    const concept = detailString(error, "concept");
    if (role && concept && (role === "metric" || role === "dimension" || role === "filter")) {
      return {
        title: "We couldn't analyse that question.",
        message: `The requested ${role} '${concept}' is not available in this dataset.`,
      };
    }
  }

  if (code === "intent_mismatch") {
    const message = detailString(error, "publicMessage");
    return {
      title: "We couldn't analyse that question.",
      message: message ?? "The analysis does not answer the question that was asked.",
    };
  }

  if (code === "invalid_question") {
    return {
      title: "Enter a question",
      message: "Ask something about this dataset.",
    };
  }

  if (error.error.stage === "validate-plan") {
    return {
      title: "We couldn't analyse that question.",
      message: "InsightFlow could not build a supported analysis for this dataset.",
    };
  }

  if (error.error.stage === "plan" || error.error.stage === "explain") {
    return {
      title: "InsightFlow couldn't create an analysis plan.",
      message: "Please try the question again.",
    };
  }

  if (error.error.stage === "verify-claims") {
    return {
      title: "InsightFlow couldn't verify the answer.",
      message: "Please try the question again.",
    };
  }

  if (error.error.stage === "execute" || error.error.stage === "validate-result") {
    return {
      title: "The analysis could not be completed.",
      message: "Please try the question again.",
    };
  }

  if (code === "upload_limit") {
    return {
      title: "This file is too large.",
      message: "Upload a smaller CSV.",
    };
  }

  if (code === "invalid_file") {
    return {
      title: "Unsupported file",
      message: "Upload a CSV file.",
    };
  }

  if (code === "empty_file") {
    return {
      title: "Empty file",
      message: "The CSV file is empty.",
    };
  }

  if (code === "row_limit") {
    return {
      title: "This dataset is too large.",
      message: "InsightFlow analyses up to 50,000 rows.",
    };
  }

  return {
    title: "This dataset contains data that InsightFlow can't reliably analyse.",
    message: "Upload a CSV with a header row and consistent columns.",
  };
}

function detailCode(error: AnalysisFailure): string | undefined {
  const details = error.error.details;
  if (!details || typeof details !== "object" || Array.isArray(details) || !("code" in details)) {
    return undefined;
  }
  return typeof details.code === "string" ? details.code : undefined;
}

function detailColumn(error: AnalysisFailure): string | undefined {
  const column = detailString(error, "column");
  return column && /^[\w .'-]+$/.test(column) ? column : undefined;
}

function detailString(error: AnalysisFailure, key: string): string | undefined {
  const details = error.error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return undefined;
  }
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 && value.length < 240 && !/[\\/]/.test(value) ? value : undefined;
}
