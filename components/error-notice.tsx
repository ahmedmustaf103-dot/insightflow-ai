import type { PublicErrorBody } from "@/lib/api/error-body";

export function ErrorNotice({ error }: { error: PublicErrorBody["error"] }) {
  return (
    <div role="alert" className="rounded-2xl border border-danger/20 bg-danger-bg px-5 py-5 text-danger sm:px-6">
      <p className="text-lg font-medium">{error.title}</p>
      <p className="mt-2 text-sm leading-6">{error.message}</p>
    </div>
  );
}
