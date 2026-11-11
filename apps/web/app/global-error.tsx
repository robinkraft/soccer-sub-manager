"use client";

/**
 * Minimal global error UI — must not import next/font, @ui, or other layout deps.
 * Next replaces the root layout here; a default boundary can break when those deps
 * expect the normal app tree (React useContext null during prerender).
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <h1>Something went wrong</h1>
        <button type="button" onClick={() => reset()}>
          Try again
        </button>
      </body>
    </html>
  );
}
