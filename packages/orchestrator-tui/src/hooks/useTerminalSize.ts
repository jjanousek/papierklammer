import { useState, useEffect } from "react";
import { useStdout } from "ink";

export interface TerminalSize {
  columns: number;
  rows: number;
}

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const MIN_COLUMNS = 40;
const MIN_ROWS = 6;

function normalizeDimension(
  value: number | undefined,
  fallback: number,
  minimum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(value));
}

/**
 * Hook that tracks terminal dimensions using Ink's useStdout().
 *
 * Returns { columns, rows } and re-renders on terminal resize.
 * Falls back to 80x24 when dimensions are unavailable (e.g. in tests).
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();

  const [size, setSize] = useState<TerminalSize>(() => ({
    columns: normalizeDimension((stdout as NodeJS.WriteStream).columns, DEFAULT_COLUMNS, MIN_COLUMNS),
    rows: normalizeDimension((stdout as NodeJS.WriteStream).rows, DEFAULT_ROWS, MIN_ROWS),
  }));

  useEffect(() => {
    const stream = stdout as NodeJS.WriteStream;

    const handleResize = (): void => {
      setSize((current) => {
        const next = {
          columns: normalizeDimension(stream.columns, DEFAULT_COLUMNS, MIN_COLUMNS),
          rows: normalizeDimension(stream.rows, DEFAULT_ROWS, MIN_ROWS),
        };
        if (next.columns === current.columns && next.rows === current.rows) {
          return current;
        }
        return next;
      });
    };

    // Listen for resize events
    if (typeof stream.on === "function") {
      stream.on("resize", handleResize);
    }

    // Also read current dimensions on mount (in case they changed)
    handleResize();

    return () => {
      if (typeof stream.removeListener === "function") {
        stream.removeListener("resize", handleResize);
      }
    };
  }, [stdout]);

  return size;
}
