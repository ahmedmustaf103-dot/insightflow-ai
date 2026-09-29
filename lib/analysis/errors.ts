import type { AnalysisError } from "./types";

export class AnalysisFailure extends Error {
  readonly error: AnalysisError;

  constructor(error: AnalysisError) {
    super(error.message);
    this.name = "AnalysisFailure";
    this.error = error;
  }
}
