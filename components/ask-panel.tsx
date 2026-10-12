"use client";

import { useState } from "react";
import { AnswerCopy } from "@/components/answer-view";

export const EXAMPLE_QUESTIONS = [
  "Which products generated the most revenue in 2025?",
  "How did revenue change each month in 2025?",
  "Which region generated the most revenue?",
  "Show me the top products by revenue.",
];

export function AskPanel({
  disabled = false,
  analyzing = false,
  answer,
  onSubmit,
  onEndChat,
}: {
  disabled?: boolean;
  analyzing?: boolean;
  answer: string | null;
  onSubmit: (question: string) => void;
  onEndChat: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);

  function submit(next = question) {
    const value = next.trim();
    if (!value || disabled) return;
    setAsked(value);
    setQuestion("");
    onSubmit(value);
  }

  return (
    <aside className="flex w-full shrink-0 flex-col border-line bg-card lg:h-screen lg:w-[380px] lg:border-l">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span className="text-accent" aria-hidden="true">
            ✦
          </span>
          Ask AI
        </h2>
        <button
          type="button"
          onClick={() => {
            setAsked(null);
            setQuestion("");
            onEndChat();
          }}
          className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover"
        >
          End Chat
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
        {asked ? (
          <p className="ml-8 rounded-2xl rounded-br-md bg-paper px-4 py-3 text-sm leading-6">{asked}</p>
        ) : (
          <p className="text-sm leading-6 text-muted">Ask a question about the dataset. The chart and table update from the calculated result.</p>
        )}
        {analyzing ? (
          <p role="status" className="text-sm text-muted">
            Analyzing your data…
          </p>
        ) : null}
        {answer ? (
          <div className="rounded-2xl bg-paper px-4 py-3">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-accent">INSIGHTFLOW</p>
            <div className="mt-2 text-sm leading-6">
              <AnswerCopy answer={answer} />
            </div>
          </div>
        ) : null}
        {asked ? null : (
          <div className="mt-auto grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {EXAMPLE_QUESTIONS.map((example) => (
              <button
                key={example}
                type="button"
                aria-label={example}
                disabled={disabled}
                onClick={() => {
                  setQuestion(example);
                }}
                className="rounded-2xl border border-line px-4 py-3 text-left text-sm leading-6 text-ink transition hover:border-accent disabled:opacity-40"
              >
                <span className="block">{example}</span>
                <span className="mt-2 block text-xs font-medium text-accent">Ask this</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <form
        className="border-t border-line p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2 rounded-full border border-line bg-paper px-4 py-2">
          <label htmlFor="question" className="sr-only">
            Ask anything about your data
          </label>
          <textarea
            id="question"
            name="question"
            rows={1}
            maxLength={500}
            value={question}
            disabled={disabled}
            placeholder="What's your question..."
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="max-h-24 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm leading-6 outline-none"
          />
          <button
            type="submit"
            aria-label="Analyze"
            disabled={disabled || question.trim().length === 0}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-white transition hover:bg-accent-hover disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </form>
    </aside>
  );
}
