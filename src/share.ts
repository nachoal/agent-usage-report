import { writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

interface CostBreakdown {
  inputUSD: number;
  cachedInputUSD: number;
  outputUSD: number;
  totalUSD: number;
}

interface DailyReportRow {
  date: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  events: number;
  costBreakdownUSD: CostBreakdown;
  costUSD: number;
  modelTotals: Record<string, number>;
  modelBreakdown: Array<Record<string, unknown>>;
  displayValue: number;
}

interface ProviderReport {
  providerId: string;
  providerLabel: string;
  providerShortLabel: string;
  days: DailyReportRow[];
  monthly: Array<Record<string, unknown>>;
  costTotalsUSD: CostBreakdown;
  scan: Record<string, number>;
}

interface ReportPayload {
  generatedAtDisplay: string;
  generatedLocalDate: string;
  timezone: string;
  providerOrder: string[];
  providers: Record<string, ProviderReport>;
  combined: ProviderReport;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const FONT_FAMILY = "Inter, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif";
const CELL_SIZE = 18;
const CELL_GAP = 4;
const WEEKDAY_LABEL_WIDTH = 42;
const HEADER_HEIGHT = 80;
const STATS_BAR_HEIGHT = 56;
const STATS_BAR_GAP = 16;
const SECTION_HEADER_HEIGHT = 28;
const LEGEND_HEIGHT = 36;
const SECTION_GAP = 48;
const CANVAS_WIDTH = 1600;
const H_PADDING = 64;
const V_PADDING = 48;
const MONTH_ROW_HEIGHT = 28;
const HEATMAP_PADDING_TOP = 12;
const PNG_RENDER_WIDTH = 3200;
const HEATMAP_COLORS = ["#ebedf0", "#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8", "#1e3a5f"];
const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs < 1000) return Math.round(value).toString();
  const units = [
    { value: 1e12, suffix: "T" },
    { value: 1e9, suffix: "B" },
    { value: 1e6, suffix: "M" },
    { value: 1e3, suffix: "K" },
  ];
  for (const unit of units) {
    if (abs >= unit.value) {
      const scaled = value / unit.value;
      const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
      return `${scaled
        .toFixed(digits)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*[1-9])0+$/, "$1")}${unit.suffix}`;
    }
  }
  return value.toString();
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value || 0);
}

function parseIsoDate(dateString: string): Date {
  return new Date(`${dateString}T12:00:00`);
}

function isoDateString(dateObj: Date): string {
  return dateObj.toISOString().slice(0, 10);
}

function addDays(dateObj: Date, days: number): Date {
  const next = new Date(dateObj);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfWeek(dateObj: Date): Date {
  const day = dateObj.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  return addDays(dateObj, -mondayOffset);
}

function endOfWeek(dateObj: Date): Date {
  const day = dateObj.getUTCDay();
  const sundayOffset = day === 0 ? 0 : 7 - day;
  return addDays(dateObj, sundayOffset);
}

function startOfCurrentMonthLastYear(dateObj: Date): Date {
  return new Date(Date.UTC(dateObj.getUTCFullYear() - 1, dateObj.getUTCMonth(), 1, 12, 0, 0));
}

function getCalendarRange(
  report: ReportPayload,
  providers: ProviderReport[],
): { start: string; end: string; dates: string[] } {
  const allDays = providers.flatMap((provider) => provider.days.map((day) => day.date)).sort();
  const fallbackEndDate = report.generatedLocalDate || allDays.at(-1) || isoDateString(new Date());
  const end = endOfWeek(parseIsoDate(fallbackEndDate));
  const baselineStart = isoDateString(startOfCurrentMonthLastYear(parseIsoDate(fallbackEndDate)));
  const start = startOfWeek(
    parseIsoDate(allDays.length > 0 && allDays[0]! < baselineStart ? allDays[0]! : baselineStart),
  );
  const dates: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(isoDateString(cursor));
  }
  return {
    start: isoDateString(start),
    end: isoDateString(end),
    dates,
  };
}

function quantile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.floor((sortedValues.length - 1) * ratio);
  return sortedValues[index]!;
}

function buildThresholds(values: number[]): number[] {
  const positive = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (positive.length === 0) return [0, 0, 0, 0];
  const thresholds = [
    quantile(positive, 0.2),
    quantile(positive, 0.45),
    quantile(positive, 0.7),
    quantile(positive, 0.9),
  ].map((value) => Math.max(1, value));
  for (let index = 1; index < thresholds.length; index += 1) {
    thresholds[index] = Math.max(thresholds[index]!, thresholds[index - 1]!);
  }
  return thresholds;
}

function levelForValue(value: number, thresholds: number[]): number {
  if (!value) return 0;
  if (value <= thresholds[0]!) return 1;
  if (value <= thresholds[1]!) return 2;
  if (value <= thresholds[2]!) return 3;
  if (value <= thresholds[3]!) return 4;
  return 5;
}

function getHeatmapMetricValue(day: DailyReportRow): number {
  if ((day.totalTokens || 0) <= 0) {
    return day.displayValue || 0;
  }
  return day.totalTokens || 0;
}

function getMonthLabels(dates: string[], rangeStart: string): Array<{ label: string; x: number }> {
  const labels: Array<{ label: string; x: number }> = [];
  const used = new Set<string>();
  const MIN_LABEL_GAP = 44;

  // Find the first -01 date on or after rangeStart to anchor the labels
  let anchorIndex = -1;
  for (let index = 0; index < dates.length; index += 1) {
    const dateKey = dates[index]!;
    if (dateKey >= rangeStart && dateKey.endsWith("-01")) {
      anchorIndex = index;
      break;
    }
  }

  // If no -01 found, fall back to the range start
  if (anchorIndex === -1) {
    const startIndex = Math.max(dates.indexOf(rangeStart), 0);
    labels.push({
      label: parseIsoDate(rangeStart).toLocaleString("en-US", { month: "short" }),
      x: Math.floor(startIndex / 7) * (CELL_SIZE + CELL_GAP),
    });
    used.add(rangeStart.slice(0, 7));
  }

  for (let index = 0; index < dates.length; index += 1) {
    const dateKey = dates[index]!;
    if (dateKey < rangeStart || !dateKey.endsWith("-01")) continue;
    const month = dateKey.slice(0, 7);
    if (used.has(month)) continue;
    used.add(month);
    const x = Math.floor(index / 7) * (CELL_SIZE + CELL_GAP);
    const prev = labels.at(-1);
    if (prev && x - prev.x < MIN_LABEL_GAP) continue;
    labels.push({
      label: parseIsoDate(dateKey).toLocaleString("en-US", { month: "short" }),
      x,
    });
  }

  return labels;
}

function getProviderSections(report: ReportPayload): ProviderReport[] {
  const providerIds = report.providerOrder ?? [];
  const providers = providerIds
    .map((providerId) => report.providers[providerId])
    .filter((provider): provider is ProviderReport => Boolean(provider));
  return providers.length > 1 ? providers : providers.slice(0, 1);
}

function renderStatsBar(
  provider: ProviderReport,
  x: number,
  y: number,
  width: number,
): string {
  const totalTokens = provider.days.reduce((sum, day) => sum + (day.totalTokens || 0), 0);
  const totalInput = provider.days.reduce((sum, day) => sum + (day.inputTokens || 0), 0);
  const totalOutput = provider.days.reduce((sum, day) => sum + (day.outputTokens || 0), 0);
  const totalCost = provider.days.reduce((sum, day) => sum + (day.costUSD || 0), 0);
  const activeDays = provider.days.filter(
    (day) => (day.totalTokens || 0) > 0 || (day.displayValue || 0) > 0,
  ).length;
  const topModel = [...provider.days]
    .flatMap((day) => day.modelBreakdown)
    .reduce<Map<string, number>>((map, entry) => {
      const name = String(entry.name);
      map.set(name, (map.get(name) ?? 0) + Number(entry.totalTokens ?? 0));
      return map;
    }, new Map());
  const topModelEntry = [...topModel.entries()].sort((a, b) => b[1] - a[1])[0];

  const stats = [
    { label: "TOTAL TOKENS", value: formatCompactNumber(totalTokens) },
    { label: "EST. COST", value: formatCurrency(totalCost) },
    { label: "TOP MODEL", value: topModelEntry ? topModelEntry[0] : "—" },
    { label: "ACTIVE DAYS", value: `${activeDays}` },
  ];

  const colWidth = Math.floor(width / stats.length);
  let svg = `<g transform="translate(${x}, ${y})">`;
  svg += `<rect x="0" y="0" width="${width}" height="${STATS_BAR_HEIGHT}" rx="8" fill="#fafafa" stroke="#ebebeb" />`;

  for (let i = 0; i < stats.length; i++) {
    const stat = stats[i]!;
    const sx = i * colWidth + 20;
    svg += `<text x="${sx}" y="20" font-family="${FONT_FAMILY}" font-size="11" font-weight="500" fill="#999999" letter-spacing="0.3">${escapeXml(stat.label)}</text>`;
    svg += `<text x="${sx}" y="42" font-family="${FONT_FAMILY}" font-size="18" font-weight="500" fill="#111111">${escapeXml(stat.value)}</text>`;
    if (i < stats.length - 1) {
      svg += `<line x1="${(i + 1) * colWidth}" y1="10" x2="${(i + 1) * colWidth}" y2="${STATS_BAR_HEIGHT - 10}" stroke="#ebebeb" />`;
    }
  }

  svg += `</g>`;
  return svg;
}

function renderSection(
  provider: ProviderReport,
  x: number,
  y: number,
  calendar: { start: string; end: string; dates: string[] },
  width: number,
): string {
  const dayMap = new Map(provider.days.map((day) => [day.date, day]));
  const values = provider.days.map((day) => getHeatmapMetricValue(day));
  const thresholds = buildThresholds(values);

  const heatmapOffsetY = SECTION_HEADER_HEIGHT + STATS_BAR_HEIGHT + STATS_BAR_GAP;
  const gridX = WEEKDAY_LABEL_WIDTH;
  const gridY = heatmapOffsetY + MONTH_ROW_HEIGHT + HEATMAP_PADDING_TOP;
  const sectionHeight =
    heatmapOffsetY +
    MONTH_ROW_HEIGHT +
    HEATMAP_PADDING_TOP +
    7 * CELL_SIZE +
    6 * CELL_GAP +
    LEGEND_HEIGHT;

  let svg = `<g transform="translate(${x}, ${y})">`;

  // Provider name — flat, no container
  svg += `<text x="0" y="18" font-family="${FONT_FAMILY}" font-size="20" font-weight="500" fill="#111111">${escapeXml(provider.providerLabel)}</text>`;

  // Compact stats bar
  svg += renderStatsBar(provider, 0, SECTION_HEADER_HEIGHT, width);

  // Month labels
  const monthLabels = getMonthLabels(calendar.dates, calendar.start);
  for (const label of monthLabels) {
    svg += `<text x="${gridX + label.x}" y="${heatmapOffsetY + 20}" font-family="${FONT_FAMILY}" font-size="11" fill="#bbbbbb">${escapeXml(label.label)}</text>`;
  }

  // Weekday labels — Mon and Sun only
  for (let row = 0; row < WEEKDAY_NAMES.length; row += 1) {
    const label = row === 0 || row === 6 ? WEEKDAY_NAMES[row]! : "";
    if (label) {
      svg += `<text x="${WEEKDAY_LABEL_WIDTH - 8}" y="${gridY + row * (CELL_SIZE + CELL_GAP) + 13}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="11" fill="#bbbbbb">${label}</text>`;
    }
  }

  // Heatmap cells
  for (let index = 0; index < calendar.dates.length; index += 1) {
    const dateKey = calendar.dates[index]!;
    const row = index % 7;
    const col = Math.floor(index / 7);
    const day = dayMap.get(dateKey);
    const value = day ? getHeatmapMetricValue(day) : 0;
    const level = levelForValue(value, thresholds);
    const fill = HEATMAP_COLORS[level]!;
    svg += `<rect x="${gridX + col * (CELL_SIZE + CELL_GAP)}" y="${gridY + row * (CELL_SIZE + CELL_GAP)}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="4" fill="${fill}" />`;
  }

  // Legend
  const legendY = gridY + 7 * CELL_SIZE + 6 * CELL_GAP + 20;
  svg += `<text x="${gridX}" y="${legendY}" font-family="${FONT_FAMILY}" font-size="11" fill="#bbbbbb">Less</text>`;
  for (let index = 0; index < HEATMAP_COLORS.length; index += 1) {
    svg += `<rect x="${gridX + 34 + index * 18}" y="${legendY - 10}" width="14" height="14" rx="4" fill="${HEATMAP_COLORS[index]!}" />`;
  }
  svg += `<text x="${gridX + 34 + HEATMAP_COLORS.length * 18 + 6}" y="${legendY}" font-family="${FONT_FAMILY}" font-size="11" fill="#bbbbbb">More</text>`;

  // Bottom divider
  svg += `<line x1="0" y1="${sectionHeight}" x2="${width}" y2="${sectionHeight}" stroke="#f0f0f0" />`;

  svg += `</g>`;
  return svg;
}

export function renderSharePosterSvg(report: ReportPayload): string {
  const providers = getProviderSections(report);
  const calendar = getCalendarRange(report, providers);
  const columns = Math.ceil(calendar.dates.length / 7);
  const gridWidth = columns * CELL_SIZE + (columns - 1) * CELL_GAP;
  const sectionWidth = WEEKDAY_LABEL_WIDTH + gridWidth + 36;
  const sectionX = H_PADDING;
  const heatmapOffsetY = SECTION_HEADER_HEIGHT + STATS_BAR_HEIGHT + STATS_BAR_GAP;
  const sectionHeight =
    heatmapOffsetY +
    MONTH_ROW_HEIGHT +
    HEATMAP_PADDING_TOP +
    7 * CELL_SIZE +
    6 * CELL_GAP +
    LEGEND_HEIGHT;
  const totalHeight =
    V_PADDING +
    HEADER_HEIGHT +
    providers.length * sectionHeight +
    Math.max(providers.length - 1, 0) * SECTION_GAP +
    V_PADDING;

  const combinedTotalTokens = providers.reduce(
    (sum, provider) =>
      sum + provider.days.reduce((daySum, day) => daySum + (day.totalTokens || 0), 0),
    0,
  );
  const combinedCost = providers.reduce(
    (sum, provider) => sum + provider.days.reduce((daySum, day) => daySum + (day.costUSD || 0), 0),
    0,
  );
  const dateRange = `${parseIsoDate(calendar.start).toLocaleString("en-US", { month: "short", year: "numeric" })} – ${parseIsoDate(calendar.end).toLocaleString("en-US", { month: "short", year: "numeric" })}`;

  let svg = `<svg xmlns="${SVG_NS}" width="${CANVAS_WIDTH}" height="${totalHeight}" viewBox="0 0 ${CANVAS_WIDTH} ${totalHeight}">`;
  svg += `<rect width="${CANVAS_WIDTH}" height="${totalHeight}" fill="#ffffff" />`;

  // Header — compact, editorial
  svg += `<text x="${H_PADDING}" y="${V_PADDING + 28}" font-family="${FONT_FAMILY}" font-size="28" font-weight="500" fill="#111111">Agent Usage</text>`;
  svg += `<text x="${H_PADDING + 210}" y="${V_PADDING + 28}" font-family="${FONT_FAMILY}" font-size="14" fill="#999999">${escapeXml(dateRange)} · ${escapeXml(report.timezone || "")}</text>`;

  // Combined stats — right aligned, compact
  svg += `<text x="${CANVAS_WIDTH - H_PADDING}" y="${V_PADDING + 16}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="11" font-weight="500" fill="#999999" letter-spacing="0.3">COMBINED</text>`;
  svg += `<text x="${CANVAS_WIDTH - H_PADDING}" y="${V_PADDING + 40}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="20" font-weight="500" fill="#111111">${escapeXml(formatCompactNumber(combinedTotalTokens))} tokens · ${escapeXml(formatCurrency(combinedCost))}</text>`;

  // Divider below header
  svg += `<line x1="${H_PADDING}" y1="${V_PADDING + 56}" x2="${CANVAS_WIDTH - H_PADDING}" y2="${V_PADDING + 56}" stroke="#ebebeb" />`;

  providers.forEach((provider, index) => {
    const y = V_PADDING + HEADER_HEIGHT + index * (sectionHeight + SECTION_GAP);
    svg += renderSection(provider, sectionX, y, calendar, sectionWidth);
  });

  svg += `</svg>`;
  return svg;
}

export async function renderSharePosterPng(svg: string, outputPath: string): Promise<void> {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: PNG_RENDER_WIDTH,
    },
    background: "white",
  });
  const pngData = resvg.render();
  await writeFile(outputPath, pngData.asPng());
}
