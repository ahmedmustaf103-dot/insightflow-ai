"use client";

import { useState } from "react";

export const EXAMPLE_QUESTIONS = [
  "Which products generated the most revenue in 2025?",
  "How did revenue change each month in 2025?",
  "Which region generated the most revenue?",
  "Show me the top products by revenue.",
];

export function QuestionForm({
  disabled = false,
  onSubmit,
}: {
  disabled?: boolean;
  onSubmit: (question: string) => void;
}) {
  const [question, setQuestion] = useState("");

  return (
    <form
      className="rounded-2xl border border-line bg-card px-5 py-5 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        const next = question.trim();
        if (!next || disabled) return;
        onSubmit(next);
      }}
    >
      <label htmlFor="question" className="text-lg font-medium">
        Ask anything about your data
      </label>
      <textarea
        id="question"
        name="question"
        rows={3}
        maxLength={500}
        value={question}
        disabled={disabled}
        placeholder="Which products generated the most revenue in 2025?"
        onChange={(event) => setQuestion(event.target.value)}
        className="mt-4 w-full resize-none rounded-xl border border-line bg-paper px-4 py-3 text-base leading-7 outline-none focus-visible:border-accent"
      />
      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={disabled || question.trim().length === 0}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {disabled ? "Analyzing…" : "Analyze"}
        </button>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {EXAMPLE_QUESTIONS.map((example) => (
          <button
            key={example}
            type="button"
            disabled={disabled}
            onClick={() => setQuestion(example)}
            className="rounded-full border border-line px-3 py-1.5 text-left text-sm text-muted transition hover:border-accent hover:text-ink disabled:opacity-40"
          >
            {example}
          </button>
        ))}
      </div>
    </form>
  );
}
