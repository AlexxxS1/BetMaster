import type { ChartSeries, MatchChart } from "../shared/types";

export function ChartCard({ chart }: { chart: MatchChart }) {
  const empty = chart.series.every((series) => series.points.length === 0);
  return (
    <figure className="chart-card" data-testid={`chart-${chart.id}`}>
      <figcaption>
        <h3>{chart.title}</h3>
        <p className="measures">{chart.measures}</p>
        <p className="effect">{chart.effect}</p>
      </figcaption>
      {empty ? (
        <p className="muted">V okně před zápasem na tohle není dost zápasů.</p>
      ) : chart.kind === "line" ? (
        <LineChart series={chart.series} />
      ) : (
        <BarChart series={chart.series} color={chart.color} />
      )}
      <p className="chart-summary">{chart.summary}</p>
    </figure>
  );
}

function LineChart({ series }: { series: ChartSeries[] }) {
  const width = 640;
  const height = 196;
  const pad = { l: 46, r: 12, t: 22, b: 24 };
  const dates = [
    ...new Set(
      series.flatMap((item) => item.points.map((point) => point.label)).filter((label) => label !== "start"),
    ),
  ].sort();
  const axis = ["start", ...dates];
  const aligned = series.map((item) => ({ ...item, values: carry(item, axis) }));
  const values = aligned.flatMap((item) => item.values);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(30, max - min);
  const y0 = min - span * 0.08;
  const y1 = max + span * 0.08;
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const xAt = (index: number) => pad.l + (axis.length <= 1 ? innerW / 2 : (index / (axis.length - 1)) * innerW);
  const yAt = (value: number) => pad.t + ((y1 - value) / (y1 - y0)) * innerH;

  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img">
      {1500 >= y0 && 1500 <= y1 ? (
        <line className="chart-axis" x1={pad.l} y1={yAt(1500)} x2={width - pad.r} y2={yAt(1500)} />
      ) : null}
      {aligned.map((item) => (
        <polyline
          key={item.name}
          className={`tone-${item.tone}`}
          fill="none"
          strokeWidth="2.4"
          points={item.values.map((value, index) => `${xAt(index)},${yAt(value)}`).join(" ")}
        />
      ))}
      <text className="chart-label" x={4} y={yAt(max) + 4}>
        {Math.round(max)}
      </text>
      <text className="chart-label" x={4} y={yAt(min) + 4}>
        {Math.round(min)}
      </text>
      <text className="chart-label" x={pad.l} y={height - 6}>
        start
      </text>
      <text className="chart-label" x={width - 78} y={height - 6}>
        {dates.at(-1) ?? ""}
      </text>
      {aligned.map((item, index) => (
        <text key={item.name} className={`tone-${item.tone} chart-label`} x={pad.l + index * 72} y={14}>
          {item.name}
        </text>
      ))}
    </svg>
  );
}

function carry(series: ChartSeries, axis: string[]): number[] {
  let current = series.points[0]?.value ?? 1500;
  return axis.map((label) => {
    const matches = series.points.filter((point) => point.label === label);
    if (matches.length > 0) current = matches[matches.length - 1].value;
    return current;
  });
}

function BarChart({ series, color }: { series: ChartSeries[]; color: "tone" | "sign" }) {
  const rows = series.flatMap((item) =>
    item.points.map((point) => ({
      key: `${item.name}-${point.label}`,
      label: point.label,
      value: point.value,
      tone: item.tone,
    })),
  );
  const width = 640;
  const rowH = 26;
  const height = Math.max(rows.length, 1) * rowH + 8;
  const labelW = 168;
  const values = rows.map((row) => row.value);
  const max = Math.max(...values.map((value) => Math.abs(value)), color === "sign" ? 0.05 : 1);
  const plotW = width - labelW - 16;
  const zero = color === "sign" ? labelW + plotW / 2 : labelW;
  const span = color === "sign" ? plotW / 2 : plotW;

  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img">
      {color === "sign" ? <line className="chart-axis" x1={zero} y1={4} x2={zero} y2={height - 4} /> : null}
      {rows.map((row, index) => {
        const y = 6 + index * rowH;
        const length = (Math.abs(row.value) / max) * span;
        const x = color === "sign" ? (row.value >= 0 ? zero : zero - length) : labelW;
        const tone = color === "sign" ? (row.value >= 0 ? "home" : "away") : row.tone;
        return (
          <g key={row.key}>
            <text className="chart-label" x={4} y={y + 14}>
              {row.label}
            </text>
            <rect className={`tone-${tone}`} x={x} y={y + 4} width={Math.max(length, 1)} height={14} rx={3} />
          </g>
        );
      })}
    </svg>
  );
}
