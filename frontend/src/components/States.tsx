import { useFilters } from "../filters";

export function Loading() {
  return <p className="py-6 text-cap text-ink-3" role="status">Loading…</p>;
}

export function Empty({ message = "No respondents match these filters" }: { message?: string }) {
  const { reset } = useFilters();
  return (
    <p className="py-6 text-body text-ink-2">
      {message} — <button className="text-accent underline" onClick={reset}>Reset</button>
    </p>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <p className="rounded border border-bad px-3 py-2 text-body text-bad" role="alert">
      Request failed: {message}
    </p>
  );
}

/** Loading / error / empty switch shared by every card body. */
export function Guard({ loading, error, empty, children }: {
  loading: boolean; error?: string; empty?: boolean; children: () => React.ReactNode;
}) {
  if (error) return <ErrorState message={error} />;
  if (loading && empty === undefined) return <Loading />;
  if (empty) return <Empty />;
  return <>{children()}</>;
}
