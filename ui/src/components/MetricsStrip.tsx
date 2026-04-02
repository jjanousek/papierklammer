interface MetricItem {
  label: string;
  value: string;
}

interface MetricsStripProps {
  metrics: MetricItem[];
}

export function MetricsStrip({ metrics }: MetricsStripProps) {
  return (
    <div
      className="flex w-full border-b border-[var(--border)]"
      style={{ minHeight: "44px" }}
    >
      {metrics.map((metric, i) => (
        <div
          key={metric.label}
          className="flex-1 flex flex-col justify-center px-3 py-2"
          style={{
            borderRight: i < metrics.length - 1 ? "1px solid var(--border)" : "none",
          }}
        >
          <span
            style={{
              fontSize: "9px",
              fontWeight: 400,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "var(--fg-dim)",
            }}
          >
            {metric.label}
          </span>
          <span
            style={{
              fontSize: "15px",
              fontWeight: 500,
              color: "var(--fg)",
            }}
          >
            {metric.value}
          </span>
        </div>
      ))}
    </div>
  );
}
