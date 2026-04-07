import { existsSync, readdirSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform as osPlatform, release as osRelease } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import picocolors from "picocolors";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MILLION = 1_000_000;
const REPORT_SCHEMA_VERSION = 2;
const DEFAULT_TIMEZONE = "America/Mexico_City";
const DEFAULT_PROVIDER_ID = "codex";
const DEFAULT_PROVIDER_LABEL = "Codex CLI";
const DEFAULT_PROVIDER_SHORT_LABEL = "Codex";
const CLAUDE_PROVIDER_ID = "claude";
const CLAUDE_PROVIDER_LABEL = "Claude Code";
const CLAUDE_PROVIDER_SHORT_LABEL = "Claude";
const OPENCODE_PROVIDER_ID = "opencode";
const OPENCODE_PROVIDER_LABEL = "Open Code";
const OPENCODE_PROVIDER_SHORT_LABEL = "OpenCode";
const PI_PROVIDER_ID = "pi";
const PI_PROVIDER_LABEL = "Pi Coding Agent";
const PI_PROVIDER_SHORT_LABEL = "Pi";
const COMBINED_PROVIDER_ID = "all";
const COMBINED_PROVIDER_LABEL = "All Providers";
const COMBINED_PROVIDER_SHORT_LABEL = "All";
const LEGACY_FALLBACK_MODEL = "gpt-5";
const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const MODEL_ALIASES: Record<string, string> = {
  "gpt-5-codex": "gpt-5",
  "gpt-5.3-codex": "gpt-5.2-codex",
};
const MODEL_PREFIXES = ["openai/", "azure/", "openrouter/openai/", "chatgpt/"];
const FREE_MODEL_PRICING = {
  inputCostPerMToken: 0,
  cachedInputCostPerMToken: 0,
  outputCostPerMToken: 0,
};
const BUILTIN_MODEL_PRICING: Record<
  string,
  { inputCostPerMToken: number; cachedInputCostPerMToken: number; outputCostPerMToken: number }
> = {
  "gpt-5": { inputCostPerMToken: 1.25, cachedInputCostPerMToken: 0.125, outputCostPerMToken: 10 },
  "gpt-5.1-codex": {
    inputCostPerMToken: 1.25,
    cachedInputCostPerMToken: 0.125,
    outputCostPerMToken: 10,
  },
  "gpt-5.1-codex-max": {
    inputCostPerMToken: 1.25,
    cachedInputCostPerMToken: 0.125,
    outputCostPerMToken: 10,
  },
  "gpt-5.1-codex-mini": {
    inputCostPerMToken: 0.25,
    cachedInputCostPerMToken: 0.025,
    outputCostPerMToken: 2,
  },
  "gpt-5.2": { inputCostPerMToken: 1.75, cachedInputCostPerMToken: 0.175, outputCostPerMToken: 14 },
  "gpt-5.2-codex": {
    inputCostPerMToken: 1.75,
    cachedInputCostPerMToken: 0.175,
    outputCostPerMToken: 14,
  },
  "gpt-5.3-codex": {
    inputCostPerMToken: 1.75,
    cachedInputCostPerMToken: 0.175,
    outputCostPerMToken: 14,
  },
  "gpt-5.4": { inputCostPerMToken: 2.5, cachedInputCostPerMToken: 0.25, outputCostPerMToken: 15 },
};
const SCAN_OUTPUT_KEYS = [
  "filesScanned",
  "jsonlFilesScanned",
  "jsonFilesScanned",
  "parseErrors",
  "nullInfoEventsSkipped",
  "duplicateEventsSkipped",
  "syntheticEventsSkipped",
  "zeroTotalEventsSkipped",
  "tokenEventsCounted",
  "unsupportedLegacyFiles",
  "activityOnlyDays",
] as const;

type Pricing = typeof FREE_MODEL_PRICING;
type ScanKey = (typeof SCAN_OUTPUT_KEYS)[number];

export interface CliArgs {
  codexHome: string;
  claudeConfigDir: string | null;
  opencodeDir: string | null;
  piAgentDir: string | null;
  timezone: string;
  outputHtml: string;
  outputJson: string;
  skipArchived: boolean;
  color?: boolean | null;
}

interface UsageTotals {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

interface CostBreakdown {
  inputUSD: number;
  cachedInputUSD: number;
  outputUSD: number;
  totalUSD: number;
}

interface ModelUsageAccumulator extends UsageTotals {
  events: number;
  is_fallback_model: boolean;
}

interface DailyUsageAccumulator extends UsageTotals {
  events: number;
  model_usage: Record<string, ModelUsageAccumulator>;
}

export interface DailyReportRow {
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

export interface MonthlyReportRow {
  month: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  events: number;
  activeDays: number;
  costBreakdownUSD: CostBreakdown;
  costUSD: number;
  modelTotals: Record<string, number>;
  modelBreakdown: Array<Record<string, unknown>>;
}

interface ModelBreakdownRow extends Record<string, unknown> {
  name: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  events: number;
  isFallbackModel: boolean;
  isMissingPricing: boolean;
  isAliasPricing: boolean;
  resolvedPricingModel: string | null;
  pricingSource: string | null;
  pricingPerMToken: unknown;
  costBreakdownUSD: CostBreakdown;
  costUSD: number;
}

interface ProviderReport {
  providerId: string;
  providerLabel: string;
  providerShortLabel: string;
  sourceHome: string | null;
  days: DailyReportRow[];
  monthly: MonthlyReportRow[];
  pricing: {
    source: string;
    sourceLabel: string;
    url: string;
    missingModels: string[];
  };
  costTotalsUSD: CostBreakdown;
  scan: Record<ScanKey, number>;
}

interface ProviderScanResult {
  providerId: string;
  providerLabel: string;
  providerShortLabel: string;
  sourceHome: string | null;
  dailyUsage: Map<string, DailyUsageAccumulator>;
  displayValuesByDay: Map<string, number>;
  stats: Record<ScanKey, number>;
}

interface ClaudeRawLogEntry {
  timestamp?: string;
  requestId?: string;
  message?: {
    usage?: Record<string, unknown>;
    model?: string;
    id?: string;
  };
}

interface OpenCodeMessage {
  id?: string;
  modelID?: string;
  time?: { created?: number };
  tokens?: {
    input?: number;
    output?: number;
    cache?: { read?: number; write?: number };
  };
}

interface PiSessionEntry {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
    };
    timestamp?: string | number;
  };
}

function createEmptyUsageTotals(): UsageTotals {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };
}

function createEmptyDailyUsage(): DailyUsageAccumulator {
  return {
    ...createEmptyUsageTotals(),
    events: 0,
    model_usage: {},
  };
}

function createEmptyScanStats(): Record<ScanKey, number> {
  return {
    filesScanned: 0,
    jsonlFilesScanned: 0,
    jsonFilesScanned: 0,
    parseErrors: 0,
    nullInfoEventsSkipped: 0,
    duplicateEventsSkipped: 0,
    syntheticEventsSkipped: 0,
    zeroTotalEventsSkipped: 0,
    tokenEventsCounted: 0,
    unsupportedLegacyFiles: 0,
    activityOnlyDays: 0,
  };
}

interface CliStatusReporter {
  step: (message: string) => void;
  success: (message: string) => void;
  skip: (message: string) => void;
  info: (message: string) => void;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

function summarizePaths(paths: string[]): string {
  if (paths.length === 0) return "no paths";
  if (paths.length === 1) return paths[0]!;
  return `${paths[0]} (+${paths.length - 1} more)`;
}

function countProviderScanDays(scan: ProviderScanResult): number {
  return new Set([...scan.dailyUsage.keys(), ...scan.displayValuesByDay.keys()]).size;
}

function formatProviderScanSummary(scan: ProviderScanResult): string {
  const dayCount = countProviderScanDays(scan);
  const extras: string[] = [];
  if (scan.stats.activityOnlyDays > 0) {
    extras.push(
      `${formatCount(scan.stats.activityOnlyDays)} activity-only ${pluralize(scan.stats.activityOnlyDays, "day")}`,
    );
  }
  if (scan.stats.parseErrors > 0) {
    extras.push(
      `${formatCount(scan.stats.parseErrors)} parse ${pluralize(scan.stats.parseErrors, "error")}`,
    );
  }
  const suffix = extras.length > 0 ? `, ${extras.join(", ")}` : "";
  return (
    `${scan.providerLabel}: ${formatCount(scan.stats.filesScanned)} ${pluralize(scan.stats.filesScanned, "file")} scanned, ` +
    `${formatCount(scan.stats.tokenEventsCounted)} token ${pluralize(scan.stats.tokenEventsCounted, "event")} counted, ` +
    `${formatCount(dayCount)} ${pluralize(dayCount, "day")}${suffix}`
  );
}

function createCliStatusReporter(colorOverride?: boolean | null): CliStatusReporter {
  const colors = picocolors.createColors(colorOverride ?? undefined);
  const write = (label: string, formatter: (value: string) => string, message: string) => {
    process.stderr.write(`${formatter(colors.bold(label))} ${message}\n`);
  };

  return {
    step(message) {
      write("RUN", colors.cyan, message);
    },
    success(message) {
      write("OK", colors.green, message);
    },
    skip(message) {
      write("SKIP", colors.yellow, message);
    },
    info(message) {
      write("INFO", colors.gray, message);
    },
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseIsoTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.replace("Z", "+00:00");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseFlexibleTimestamp(value: unknown): Date | null {
  if (typeof value === "string") return parseIsoTimestamp(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    const numeric = Math.abs(value) >= 1_000_000_000_000 ? value / 1000 : value;
    const parsed = new Date(numeric * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function dayKeyInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addUsage(
  map: Map<string, DailyUsageAccumulator>,
  dayKey: string,
  usage: UsageTotals,
  model: string | null,
  isFallbackModel = false,
): void {
  const entry = map.get(dayKey) ?? createEmptyDailyUsage();
  entry.input_tokens += usage.input_tokens;
  entry.cached_input_tokens += usage.cached_input_tokens;
  entry.output_tokens += usage.output_tokens;
  entry.reasoning_output_tokens += usage.reasoning_output_tokens;
  entry.total_tokens += usage.total_tokens;
  entry.events += 1;

  if (model) {
    const modelEntry =
      entry.model_usage[model] ??
      ({
        ...createEmptyUsageTotals(),
        events: 0,
        is_fallback_model: false,
      } satisfies ModelUsageAccumulator);
    modelEntry.input_tokens += usage.input_tokens;
    modelEntry.cached_input_tokens += usage.cached_input_tokens;
    modelEntry.output_tokens += usage.output_tokens;
    modelEntry.reasoning_output_tokens += usage.reasoning_output_tokens;
    modelEntry.total_tokens += usage.total_tokens;
    modelEntry.events += 1;
    modelEntry.is_fallback_model = modelEntry.is_fallback_model || isFallbackModel;
    entry.model_usage[model] = modelEntry;
  }

  map.set(dayKey, entry);
}

function normalizeCodexUsage(raw: unknown): UsageTotals {
  const usage = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const input_tokens = Math.trunc(toNumber(usage.input_tokens));
  const cached_input_tokens = Math.trunc(
    toNumber(usage.cached_input_tokens, toNumber(usage.cache_read_input_tokens)),
  );
  const output_tokens = Math.trunc(toNumber(usage.output_tokens));
  const reasoning_output_tokens = Math.trunc(toNumber(usage.reasoning_output_tokens));
  const total_tokens = Math.trunc(toNumber(usage.total_tokens));
  return {
    input_tokens,
    cached_input_tokens,
    output_tokens,
    reasoning_output_tokens,
    total_tokens: total_tokens > 0 ? total_tokens : input_tokens + output_tokens,
  };
}

function normalizeClaudeUsage(raw: unknown): UsageTotals {
  const usage = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const cacheRead = Math.trunc(toNumber(usage.cache_read_input_tokens));
  const cacheCreation = Math.trunc(toNumber(usage.cache_creation_input_tokens));
  const input_tokens = Math.trunc(toNumber(usage.input_tokens)) + cacheRead;
  const output_tokens = Math.trunc(toNumber(usage.output_tokens)) + cacheCreation;
  return {
    input_tokens,
    cached_input_tokens: cacheRead,
    output_tokens,
    reasoning_output_tokens: 0,
    total_tokens: input_tokens + output_tokens,
  };
}

function normalizePiUsage(raw: unknown): UsageTotals {
  const usage = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const cacheRead = Math.trunc(toNumber(usage.cacheRead));
  const cacheWrite = Math.trunc(toNumber(usage.cacheWrite));
  const input_tokens = Math.trunc(toNumber(usage.input)) + cacheRead;
  const output_tokens = Math.trunc(toNumber(usage.output)) + cacheWrite;
  const total_tokens = Math.trunc(toNumber(usage.totalTokens));
  return {
    input_tokens,
    cached_input_tokens: cacheRead,
    output_tokens,
    reasoning_output_tokens: 0,
    total_tokens: total_tokens > 0 ? total_tokens : input_tokens + output_tokens,
  };
}

function normalizeOpenCodeUsage(raw: unknown): UsageTotals {
  const tokens = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const cache =
    typeof tokens.cache === "object" && tokens.cache !== null
      ? (tokens.cache as Record<string, unknown>)
      : {};
  const cacheRead = Math.trunc(toNumber(cache.read));
  const cacheWrite = Math.trunc(toNumber(cache.write));
  const input_tokens = Math.trunc(toNumber(tokens.input)) + cacheRead;
  const output_tokens = Math.trunc(toNumber(tokens.output)) + cacheWrite;
  return {
    input_tokens,
    cached_input_tokens: cacheRead,
    output_tokens,
    reasoning_output_tokens: 0,
    total_tokens: input_tokens + output_tokens,
  };
}

function addUsageTotals(base: UsageTotals | null, delta: UsageTotals): UsageTotals {
  return {
    input_tokens: (base?.input_tokens ?? 0) + delta.input_tokens,
    cached_input_tokens: (base?.cached_input_tokens ?? 0) + delta.cached_input_tokens,
    output_tokens: (base?.output_tokens ?? 0) + delta.output_tokens,
    reasoning_output_tokens: (base?.reasoning_output_tokens ?? 0) + delta.reasoning_output_tokens,
    total_tokens: (base?.total_tokens ?? 0) + delta.total_tokens,
  };
}

function subtractUsageTotals(current: UsageTotals, previous: UsageTotals | null): UsageTotals {
  return {
    input_tokens: Math.max(current.input_tokens - (previous?.input_tokens ?? 0), 0),
    cached_input_tokens: Math.max(
      current.cached_input_tokens - (previous?.cached_input_tokens ?? 0),
      0,
    ),
    output_tokens: Math.max(current.output_tokens - (previous?.output_tokens ?? 0), 0),
    reasoning_output_tokens: Math.max(
      current.reasoning_output_tokens - (previous?.reasoning_output_tokens ?? 0),
      0,
    ),
    total_tokens: Math.max(current.total_tokens - (previous?.total_tokens ?? 0), 0),
  };
}

function didUsageTotalsRollback(current: UsageTotals, previous: UsageTotals | null): boolean {
  if (!previous) return false;
  return (
    current.input_tokens < previous.input_tokens ||
    current.cached_input_tokens < previous.cached_input_tokens ||
    current.output_tokens < previous.output_tokens ||
    current.reasoning_output_tokens < previous.reasoning_output_tokens ||
    current.total_tokens < previous.total_tokens
  );
}

function isSyntheticUsage(usage: UsageTotals): boolean {
  return (
    usage.total_tokens > 0 &&
    usage.input_tokens === 0 &&
    usage.cached_input_tokens === 0 &&
    usage.output_tokens === 0 &&
    usage.reasoning_output_tokens === 0
  );
}

function modelLookupCandidates(model: string): string[] {
  const trimmed = model.trim();
  const candidates = [trimmed];
  if (!MODEL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    for (const prefix of MODEL_PREFIXES) candidates.push(`${prefix}${trimmed}`);
  }
  return candidates;
}

function hasNonZeroPricing(pricing: Record<string, unknown> | null | undefined): boolean {
  if (!pricing) return false;
  return ["input_cost_per_token", "output_cost_per_token", "cache_read_input_token_cost"].some(
    (field) => Number(pricing[field] ?? 0) > 0,
  );
}

function toPerMillion(value: unknown, fallback?: unknown): number {
  const source = value ?? fallback ?? 0;
  return Number(source) * MILLION;
}

function isOpenRouterFreeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized === "openrouter/free" ||
    (normalized.startsWith("openrouter/") && normalized.endsWith(":free"))
  );
}

interface ResolvedPricing {
  requestedModel: string;
  resolvedModel: string | null;
  pricing: Pricing;
  isMissing: boolean;
  isAlias: boolean;
  source: string;
}

export async function fetchLiteLLMPricingDataset(): Promise<
  Record<string, Record<string, unknown>>
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(LITELLM_PRICING_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`Failed to fetch pricing: ${response.status}`);
    const raw = await response.json();
    if (!raw || typeof raw !== "object") return {};
    return raw as Record<string, Record<string, unknown>>;
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveModelPricing(
  model: string,
  dataset: Record<string, Record<string, unknown>> | null,
): ResolvedPricing {
  if (isOpenRouterFreeModel(model)) {
    return {
      requestedModel: model,
      resolvedModel: model,
      pricing: { ...FREE_MODEL_PRICING },
      isMissing: false,
      isAlias: false,
      source: "free-route",
    };
  }

  const ds = dataset ?? {};
  for (const candidate of modelLookupCandidates(model)) {
    const pricing = ds[candidate];
    if (pricing && hasNonZeroPricing(pricing)) {
      return {
        requestedModel: model,
        resolvedModel: candidate,
        pricing: {
          inputCostPerMToken: toPerMillion(pricing.input_cost_per_token),
          cachedInputCostPerMToken: toPerMillion(
            pricing.cache_read_input_token_cost,
            pricing.input_cost_per_token,
          ),
          outputCostPerMToken: toPerMillion(pricing.output_cost_per_token),
        },
        isMissing: false,
        isAlias: candidate !== model,
        source: "litellm-live",
      };
    }
  }

  const alias = MODEL_ALIASES[model];
  if (alias) {
    for (const candidate of modelLookupCandidates(alias)) {
      const pricing = ds[candidate];
      if (pricing && hasNonZeroPricing(pricing)) {
        return {
          requestedModel: model,
          resolvedModel: candidate,
          pricing: {
            inputCostPerMToken: toPerMillion(pricing.input_cost_per_token),
            cachedInputCostPerMToken: toPerMillion(
              pricing.cache_read_input_token_cost,
              pricing.input_cost_per_token,
            ),
            outputCostPerMToken: toPerMillion(pricing.output_cost_per_token),
          },
          isMissing: false,
          isAlias: true,
          source: "litellm-alias",
        };
      }
    }
  }

  const builtin =
    BUILTIN_MODEL_PRICING[model] ?? (alias ? BUILTIN_MODEL_PRICING[alias] : undefined);
  if (builtin) {
    return {
      requestedModel: model,
      resolvedModel: alias ?? model,
      pricing: { ...builtin },
      isMissing: false,
      isAlias: Boolean(alias),
      source: "builtin-fallback",
    };
  }

  return {
    requestedModel: model,
    resolvedModel: null,
    pricing: { ...FREE_MODEL_PRICING },
    isMissing: true,
    isAlias: false,
    source: "missing",
  };
}

export function calculateCostBreakdown(usage: UsageTotals, pricing: Pricing): CostBreakdown {
  const cachedInput = Math.min(usage.cached_input_tokens, usage.input_tokens);
  const nonCachedInput = Math.max(usage.input_tokens - cachedInput, 0);
  const outputTokens = usage.output_tokens;
  const inputUSD = (nonCachedInput / MILLION) * pricing.inputCostPerMToken;
  const cachedInputUSD = (cachedInput / MILLION) * pricing.cachedInputCostPerMToken;
  const outputUSD = (outputTokens / MILLION) * pricing.outputCostPerMToken;
  return {
    inputUSD,
    cachedInputUSD,
    outputUSD,
    totalUSD: inputUSD + cachedInputUSD + outputUSD,
  };
}

async function listFilesRecursive(root: string, suffix: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(suffix)) {
        results.push(fullPath);
      }
    }
  }
  await walk(root);
  results.sort();
  return results;
}

async function scanCodexProvider(
  codexHome: string,
  includeArchived: boolean,
  timeZone: string,
): Promise<ProviderScanResult> {
  const dailyUsage = new Map<string, DailyUsageAccumulator>();
  const displayValuesByDay = new Map<string, number>();
  const stats = createEmptyScanStats();
  const roots = [join(codexHome, "sessions")];
  if (includeArchived) roots.push(join(codexHome, "archived_sessions"));

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const files = [
      ...(await listFilesRecursive(root, ".jsonl")),
      ...(await listFilesRecursive(root, ".json")),
    ].sort();
    for (const file of files) {
      stats.filesScanned += 1;
      if (file.endsWith(".jsonl")) {
        stats.jsonlFilesScanned += 1;
        await processCodexJsonlFile(file, dailyUsage, stats, timeZone);
      } else {
        stats.jsonFilesScanned += 1;
        await processLegacyJsonFile(file, stats);
      }
    }
  }

  return {
    providerId: DEFAULT_PROVIDER_ID,
    providerLabel: DEFAULT_PROVIDER_LABEL,
    providerShortLabel: DEFAULT_PROVIDER_SHORT_LABEL,
    sourceHome: codexHome,
    dailyUsage,
    displayValuesByDay,
    stats,
  };
}

async function processCodexJsonlFile(
  filePath: string,
  dailyUsage: Map<string, DailyUsageAccumulator>,
  stats: Record<ScanKey, number>,
  timeZone: string,
): Promise<void> {
  const content = await readFile(filePath, "utf8");
  let currentModel: string | null = null;
  let currentModelIsFallback = false;
  let previousTotals: UsageTotals | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (!line.includes('"type":"turn_context"') && !line.includes('"type":"event_msg"')) continue;
    if (!line.includes('"type":"token_count"') && !line.includes('"type":"turn_context"')) continue;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      stats.parseErrors += 1;
      continue;
    }

    const recordType = record.type;
    const payload =
      typeof record.payload === "object" && record.payload !== null
        ? (record.payload as Record<string, unknown>)
        : {};
    const extractedModel = extractCodexModel(payload);

    if (recordType === "turn_context") {
      if (extractedModel) {
        currentModel = extractedModel;
        currentModelIsFallback = false;
      }
      continue;
    }

    if (recordType !== "event_msg" || payload.type !== "token_count") continue;
    const info =
      typeof payload.info === "object" && payload.info !== null
        ? (payload.info as Record<string, unknown>)
        : null;
    if (!info) {
      stats.nullInfoEventsSkipped += 1;
      continue;
    }

    const lastUsage = normalizeCodexUsage(info.last_token_usage);
    const totalUsage = normalizeCodexUsage(info.total_token_usage);
    let rawUsage: UsageTotals | null = null;
    if (totalUsage.total_tokens > 0) {
      rawUsage = didUsageTotalsRollback(totalUsage, previousTotals)
        ? lastUsage
        : subtractUsageTotals(totalUsage, previousTotals);
      previousTotals = totalUsage;
    } else if (lastUsage.total_tokens > 0) {
      rawUsage = lastUsage;
      previousTotals = addUsageTotals(previousTotals, rawUsage);
    }

    if (!rawUsage || rawUsage.total_tokens <= 0) {
      stats.zeroTotalEventsSkipped += 1;
      continue;
    }
    if (isSyntheticUsage(rawUsage)) {
      stats.syntheticEventsSkipped += 1;
      continue;
    }
    const timestamp = parseFlexibleTimestamp(record.timestamp);
    if (!timestamp) {
      stats.parseErrors += 1;
      continue;
    }

    let eventModel = extractedModel ?? currentModel;
    let isFallbackModel = false;
    if (extractedModel) {
      currentModel = extractedModel;
      currentModelIsFallback = false;
    } else if (eventModel == null) {
      eventModel = LEGACY_FALLBACK_MODEL;
      isFallbackModel = true;
      currentModel = eventModel;
      currentModelIsFallback = true;
    } else if (currentModelIsFallback) {
      isFallbackModel = true;
    }

    addUsage(
      dailyUsage,
      dayKeyInTimezone(timestamp, timeZone),
      rawUsage,
      eventModel,
      isFallbackModel,
    );
    stats.tokenEventsCounted += 1;
  }
}

function extractCodexModel(payload: Record<string, unknown>): string | null {
  const direct = asNonEmptyString(payload.model) ?? asNonEmptyString(payload.model_name);
  if (direct) return direct;
  const info =
    typeof payload.info === "object" && payload.info !== null
      ? (payload.info as Record<string, unknown>)
      : null;
  if (info) {
    const infoModel = asNonEmptyString(info.model) ?? asNonEmptyString(info.model_name);
    if (infoModel) return infoModel;
    const metadata =
      typeof info.metadata === "object" && info.metadata !== null
        ? (info.metadata as Record<string, unknown>)
        : null;
    if (metadata) {
      const metadataModel = asNonEmptyString(metadata.model);
      if (metadataModel) return metadataModel;
    }
  }
  const metadata =
    typeof payload.metadata === "object" && payload.metadata !== null
      ? (payload.metadata as Record<string, unknown>)
      : null;
  return metadata ? asNonEmptyString(metadata.model) : null;
}

async function processLegacyJsonFile(
  filePath: string,
  stats: Record<ScanKey, number>,
): Promise<void> {
  const content = await readFile(filePath, "utf8");
  try {
    const parsed = JSON.parse(content);
    if (
      typeof parsed !== "object" ||
      parsed == null ||
      (!("usage" in parsed) && !("token_usage" in parsed))
    ) {
      stats.unsupportedLegacyFiles += 1;
    }
  } catch {
    stats.parseErrors += 1;
  }
}

function discoverClaudeWorkDirs(): string[] {
  try {
    return readdirSync(homedir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(".claude-"))
      .map((entry) => resolve(join(homedir(), entry.name)))
      .filter(
        (dir) =>
          existsSync(join(dir, "projects")) ||
          existsSync(join(dir, "stats-cache.json")) ||
          existsSync(join(dir, "history.jsonl")),
      );
  } catch {
    return [];
  }
}

function resolveClaudeConfigPaths(configuredPaths: string | null): string[] {
  const seen = new Set<string>();
  const resolvedPaths: string[] = [];
  const raw = configuredPaths ?? process.env.CLAUDE_CONFIG_DIR ?? "";
  const explicit = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => resolve(part));

  if (configuredPaths != null && configuredPaths.trim() !== "") {
    for (const path of explicit) {
      if (!seen.has(path)) {
        seen.add(path);
        resolvedPaths.push(path);
      }
    }
    return resolvedPaths;
  }

  const xdg = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  const defaults = [join(xdg, "claude"), join(homedir(), ".claude")];
  for (const path of [...explicit, ...defaults, ...discoverClaudeWorkDirs()]) {
    const resolvedPath = resolve(path);
    if (!seen.has(resolvedPath)) {
      seen.add(resolvedPath);
      resolvedPaths.push(resolvedPath);
    }
  }
  return resolvedPaths;
}

function getClaudeProjectDirs(configPaths: string[]): string[] {
  return configPaths
    .map((base) => join(base, "projects"))
    .filter((dir, index, array) => existsSync(dir) && array.indexOf(dir) === index);
}

function getClaudeStatsCacheFiles(configPaths: string[]): string[] {
  return configPaths
    .map((base) => join(base, "stats-cache.json"))
    .filter((file, index, array) => existsSync(file) && array.indexOf(file) === index);
}

function getClaudeHistoryFiles(configPaths: string[]): string[] {
  return configPaths
    .map((base) => join(base, "history.jsonl"))
    .filter((file, index, array) => existsSync(file) && array.indexOf(file) === index);
}

async function scanClaudeProvider(
  configPaths: string[],
  timeZone: string,
): Promise<ProviderScanResult> {
  const dailyUsage = new Map<string, DailyUsageAccumulator>();
  const displayValuesByDay = new Map<string, number>();
  const stats = createEmptyScanStats();
  const processedHashes = new Set<string>();

  for (const projectDir of getClaudeProjectDirs(configPaths)) {
    for (const file of await listFilesRecursive(projectDir, ".jsonl")) {
      stats.filesScanned += 1;
      stats.jsonlFilesScanned += 1;
      await processClaudeProjectFile(file, dailyUsage, stats, processedHashes, timeZone);
    }
  }

  for (const file of getClaudeStatsCacheFiles(configPaths)) {
    stats.filesScanned += 1;
    stats.jsonFilesScanned += 1;
    await processClaudeStatsCacheFile(file, dailyUsage, stats);
  }

  const coveredDates = new Set([...dailyUsage.keys()]);
  for (const file of getClaudeHistoryFiles(configPaths)) {
    stats.filesScanned += 1;
    stats.jsonlFilesScanned += 1;
    await processClaudeHistoryFile(file, displayValuesByDay, coveredDates, stats, timeZone);
  }

  return {
    providerId: CLAUDE_PROVIDER_ID,
    providerLabel: CLAUDE_PROVIDER_LABEL,
    providerShortLabel: CLAUDE_PROVIDER_SHORT_LABEL,
    sourceHome: configPaths[0] ?? null,
    dailyUsage,
    displayValuesByDay,
    stats,
  };
}

async function processClaudeProjectFile(
  filePath: string,
  dailyUsage: Map<string, DailyUsageAccumulator>,
  stats: Record<ScanKey, number>,
  processedHashes: Set<string>,
  timeZone: string,
): Promise<void> {
  const content = await readFile(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    let record: ClaudeRawLogEntry;
    try {
      record = JSON.parse(line) as ClaudeRawLogEntry;
    } catch {
      stats.parseErrors += 1;
      continue;
    }
    const timestamp = parseFlexibleTimestamp(record.timestamp);
    if (!timestamp || !record.message?.usage) continue;
    const uniqueHash =
      asNonEmptyString(record.message.id) && asNonEmptyString(record.requestId)
        ? `${record.message.id}:${record.requestId}`
        : null;
    if (uniqueHash && processedHashes.has(uniqueHash)) {
      stats.duplicateEventsSkipped += 1;
      continue;
    }
    if (uniqueHash) processedHashes.add(uniqueHash);
    const usage = normalizeClaudeUsage(record.message.usage);
    if (usage.total_tokens <= 0) {
      stats.zeroTotalEventsSkipped += 1;
      continue;
    }
    const model = asNonEmptyString(record.message.model);
    addUsage(
      dailyUsage,
      dayKeyInTimezone(timestamp, timeZone),
      usage,
      model === "<synthetic>" ? null : model,
    );
    stats.tokenEventsCounted += 1;
  }
}

function distributeTokenComponents(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || weightSum <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (weight / weightSum) * total);
  const allocated = exact.map((value) => Math.floor(value));
  let remainder = total - allocated.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({
      index,
      fraction: value - allocated[index]!,
      weight: weights[index]!,
    }))
    .sort((a, b) => b.fraction - a.fraction || b.weight - a.weight);
  for (const item of order) {
    if (remainder <= 0) break;
    allocated[item.index]! += 1;
    remainder -= 1;
  }
  return allocated;
}

function createClaudeStatsCacheUsage(
  totalTokens: number,
  usage?: Record<string, unknown>,
): UsageTotals {
  if (totalTokens <= 0) return createEmptyUsageTotals();
  const [scaledInput, scaledOutput, scaledCacheRead, scaledCacheCreation] =
    distributeTokenComponents(totalTokens, [
      Math.trunc(toNumber(usage?.inputTokens)),
      Math.trunc(toNumber(usage?.outputTokens)),
      Math.trunc(toNumber(usage?.cacheReadInputTokens)),
      Math.trunc(toNumber(usage?.cacheCreationInputTokens)),
    ]);
  if (
    scaledInput === 0 &&
    scaledOutput === 0 &&
    scaledCacheRead === 0 &&
    scaledCacheCreation === 0
  ) {
    return {
      input_tokens: totalTokens,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: totalTokens,
    };
  }
  return {
    input_tokens: scaledInput + scaledCacheRead,
    cached_input_tokens: scaledCacheRead,
    output_tokens: scaledOutput + scaledCacheCreation,
    reasoning_output_tokens: 0,
    total_tokens: totalTokens,
  };
}

async function processClaudeStatsCacheFile(
  filePath: string,
  dailyUsage: Map<string, DailyUsageAccumulator>,
  stats: Record<ScanKey, number>,
): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    stats.parseErrors += 1;
    return;
  }
  const rows = Array.isArray(parsed.dailyModelTokens) ? parsed.dailyModelTokens : [];
  const modelUsageMap =
    typeof parsed.modelUsage === "object" && parsed.modelUsage != null
      ? (parsed.modelUsage as Record<string, unknown>)
      : {};

  for (const row of rows) {
    if (typeof row !== "object" || row == null) continue;
    const date = asNonEmptyString((row as Record<string, unknown>).date);
    if (!date || dailyUsage.has(date)) continue;
    const tokensByModel =
      typeof (row as Record<string, unknown>).tokensByModel === "object" &&
      (row as Record<string, unknown>).tokensByModel != null
        ? ((row as Record<string, unknown>).tokensByModel as Record<string, unknown>)
        : {};
    for (const [rawModelName, totalTokensRaw] of Object.entries(tokensByModel)) {
      const totalTokens = Math.trunc(toNumber(totalTokensRaw));
      if (totalTokens <= 0) continue;
      const usage = createClaudeStatsCacheUsage(
        totalTokens,
        typeof modelUsageMap[rawModelName] === "object" && modelUsageMap[rawModelName] != null
          ? (modelUsageMap[rawModelName] as Record<string, unknown>)
          : undefined,
      );
      addUsage(dailyUsage, date, usage, rawModelName);
    }
  }
}

async function processClaudeHistoryFile(
  filePath: string,
  displayValuesByDay: Map<string, number>,
  coveredDates: Set<string>,
  stats: Record<ScanKey, number>,
  timeZone: string,
): Promise<void> {
  const content = await readFile(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      const timestamp = parseFlexibleTimestamp(record.timestamp);
      if (!timestamp) continue;
      const dayKey = dayKeyInTimezone(timestamp, timeZone);
      if (coveredDates.has(dayKey)) continue;
      displayValuesByDay.set(dayKey, (displayValuesByDay.get(dayKey) ?? 0) + 1);
    } catch {
      stats.parseErrors += 1;
    }
  }
}

function resolveOpenCodeBaseDir(configuredPath: string | null): string | null {
  const candidates = [];
  if (configuredPath) candidates.push(resolve(configuredPath));
  if (process.env.OPENCODE_DATA_DIR?.trim())
    candidates.push(resolve(process.env.OPENCODE_DATA_DIR.trim()));
  candidates.push(resolve(join(homedir(), ".local", "share", "opencode")));
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    if (
      existsSync(join(candidate, "opencode.db")) ||
      existsSync(join(candidate, "storage", "message"))
    ) {
      return candidate;
    }
  }
  return null;
}

async function scanOpenCodeProvider(
  baseDir: string,
  timeZone: string,
): Promise<ProviderScanResult> {
  const dailyUsage = new Map<string, DailyUsageAccumulator>();
  const displayValuesByDay = new Map<string, number>();
  const stats = createEmptyScanStats();
  const dedupeIds = new Set<string>();
  const databasePath = join(baseDir, "opencode.db");
  if (existsSync(databasePath)) {
    stats.filesScanned += 1;
    await processOpenCodeDatabase(databasePath, dailyUsage, stats, dedupeIds, timeZone);
  } else {
    for (const file of await listFilesRecursive(join(baseDir, "storage", "message"), ".json")) {
      stats.filesScanned += 1;
      stats.jsonFilesScanned += 1;
      await processOpenCodeLegacyFile(file, dailyUsage, stats, dedupeIds, timeZone);
    }
  }
  return {
    providerId: OPENCODE_PROVIDER_ID,
    providerLabel: OPENCODE_PROVIDER_LABEL,
    providerShortLabel: OPENCODE_PROVIDER_SHORT_LABEL,
    sourceHome: baseDir,
    dailyUsage,
    displayValuesByDay,
    stats,
  };
}

function addOpenCodeMessage(
  message: OpenCodeMessage,
  dailyUsage: Map<string, DailyUsageAccumulator>,
  stats: Record<ScanKey, number>,
  dedupeIds: Set<string>,
  timeZone: string,
  fallbackId?: string,
): void {
  const messageId = asNonEmptyString(message.id) ?? fallbackId ?? null;
  if (messageId && dedupeIds.has(messageId)) {
    stats.duplicateEventsSkipped += 1;
    return;
  }
  if (messageId) dedupeIds.add(messageId);
  const usage = normalizeOpenCodeUsage(message.tokens);
  if (usage.total_tokens <= 0) {
    stats.zeroTotalEventsSkipped += 1;
    return;
  }
  const timestamp = parseFlexibleTimestamp(message.time?.created);
  if (!timestamp) {
    stats.parseErrors += 1;
    return;
  }
  addUsage(
    dailyUsage,
    dayKeyInTimezone(timestamp, timeZone),
    usage,
    asNonEmptyString(message.modelID),
  );
  stats.tokenEventsCounted += 1;
}

async function processOpenCodeLegacyFile(
  filePath: string,
  dailyUsage: Map<string, DailyUsageAccumulator>,
  stats: Record<ScanKey, number>,
  dedupeIds: Set<string>,
  timeZone: string,
): Promise<void> {
  try {
    const message = JSON.parse(await readFile(filePath, "utf8")) as OpenCodeMessage;
    addOpenCodeMessage(message, dailyUsage, stats, dedupeIds, timeZone);
  } catch {
    stats.parseErrors += 1;
  }
}

async function processOpenCodeDatabase(
  databasePath: string,
  dailyUsage: Map<string, DailyUsageAccumulator>,
  stats: Record<ScanKey, number>,
  dedupeIds: Set<string>,
  timeZone: string,
): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT id, data FROM message ORDER BY time_created ASC")
      .iterate() as Iterable<{ id: string; data: string }>;
    for (const row of rows) {
      try {
        const message = JSON.parse(row.data) as OpenCodeMessage;
        addOpenCodeMessage(message, dailyUsage, stats, dedupeIds, timeZone, row.id);
      } catch {
        stats.parseErrors += 1;
      }
    }
  } finally {
    db.close();
  }
}

function resolvePiSessionsDir(configuredPath: string | null): string | null {
  const candidates: string[] = [];
  if (configuredPath) candidates.push(resolve(configuredPath));
  if (process.env.PI_CODING_AGENT_DIR?.trim())
    candidates.push(resolve(process.env.PI_CODING_AGENT_DIR.trim()));
  candidates.push(resolve(join(homedir(), ".pi", "agent")));
  for (const candidate of candidates) {
    if (candidate.endsWith("/sessions") && existsSync(candidate)) return candidate;
    const sessionsDir = join(candidate, "sessions");
    if (existsSync(sessionsDir)) return sessionsDir;
  }
  return null;
}

async function scanPiProvider(sessionsDir: string, timeZone: string): Promise<ProviderScanResult> {
  const dailyUsage = new Map<string, DailyUsageAccumulator>();
  const displayValuesByDay = new Map<string, number>();
  const stats = createEmptyScanStats();
  for (const file of await listFilesRecursive(sessionsDir, ".jsonl")) {
    stats.filesScanned += 1;
    stats.jsonlFilesScanned += 1;
    await processPiJsonlFile(file, dailyUsage, stats, timeZone);
  }
  return {
    providerId: PI_PROVIDER_ID,
    providerLabel: PI_PROVIDER_LABEL,
    providerShortLabel: PI_PROVIDER_SHORT_LABEL,
    sourceHome: resolve(dirname(sessionsDir)),
    dailyUsage,
    displayValuesByDay,
    stats,
  };
}

async function processPiJsonlFile(
  filePath: string,
  dailyUsage: Map<string, DailyUsageAccumulator>,
  stats: Record<ScanKey, number>,
  timeZone: string,
): Promise<void> {
  const content = await readFile(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (!line.includes('"role":"assistant"') && !line.includes('"role": "assistant"')) continue;
    if (!line.includes('"usage"')) continue;
    let record: PiSessionEntry;
    try {
      record = JSON.parse(line) as PiSessionEntry;
    } catch {
      stats.parseErrors += 1;
      continue;
    }
    if (record.type != null && record.type !== "message") continue;
    if (record.message?.role !== "assistant" || !record.message.usage) continue;
    const usage = normalizePiUsage(record.message.usage);
    if (usage.total_tokens <= 0) {
      stats.zeroTotalEventsSkipped += 1;
      continue;
    }
    const timestamp =
      parseFlexibleTimestamp(record.timestamp) ?? parseFlexibleTimestamp(record.message.timestamp);
    if (!timestamp) {
      stats.parseErrors += 1;
      continue;
    }
    addUsage(
      dailyUsage,
      dayKeyInTimezone(timestamp, timeZone),
      usage,
      asNonEmptyString(record.message.model),
    );
    stats.tokenEventsCounted += 1;
  }
}

export function providerScanHasUsage(scan: ProviderScanResult): boolean {
  for (const usage of scan.dailyUsage.values()) {
    if (usage.total_tokens > 0) return true;
  }
  for (const value of scan.displayValuesByDay.values()) {
    if (value > 0) return true;
  }
  return false;
}

export function buildMonthlyRollups(reportDays: DailyReportRow[]): MonthlyReportRow[] {
  const months = new Map<
    string,
    {
      row: MonthlyReportRow;
      modelBreakdownIndex: Map<string, ModelBreakdownRow>;
    }
  >();

  for (const day of reportDays) {
    if ((day.totalTokens || 0) <= 0 && (day.costUSD || 0) <= 0) continue;
    const monthKey = day.date.slice(0, 7);
    let month = months.get(monthKey);
    if (!month) {
      month = {
        row: {
          month: monthKey,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          events: 0,
          activeDays: 0,
          costBreakdownUSD: { inputUSD: 0, cachedInputUSD: 0, outputUSD: 0, totalUSD: 0 },
          costUSD: 0,
          modelTotals: {},
          modelBreakdown: [],
        },
        modelBreakdownIndex: new Map(),
      };
      months.set(monthKey, month);
    }

    month.row.inputTokens += day.inputTokens;
    month.row.cachedInputTokens += day.cachedInputTokens;
    month.row.outputTokens += day.outputTokens;
    month.row.reasoningTokens += day.reasoningTokens;
    month.row.totalTokens += day.totalTokens;
    month.row.events += day.events;
    if (day.totalTokens > 0) month.row.activeDays += 1;
    month.row.costBreakdownUSD.inputUSD += day.costBreakdownUSD.inputUSD;
    month.row.costBreakdownUSD.cachedInputUSD += day.costBreakdownUSD.cachedInputUSD;
    month.row.costBreakdownUSD.outputUSD += day.costBreakdownUSD.outputUSD;
    month.row.costBreakdownUSD.totalUSD += day.costBreakdownUSD.totalUSD;
    month.row.costUSD += day.costUSD;

    for (const modelEntry of day.modelBreakdown) {
      const name = String(modelEntry.name);
      const existing: ModelBreakdownRow = month.modelBreakdownIndex.get(name) ?? {
        name,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        events: 0,
        isFallbackModel: false,
        isMissingPricing: false,
        isAliasPricing: false,
        resolvedPricingModel: asNonEmptyString(modelEntry.resolvedPricingModel) ?? null,
        pricingSource: asNonEmptyString(modelEntry.pricingSource) ?? null,
        pricingPerMToken: modelEntry.pricingPerMToken ?? null,
        costBreakdownUSD: { inputUSD: 0, cachedInputUSD: 0, outputUSD: 0, totalUSD: 0 },
        costUSD: 0,
      };
      existing.inputTokens += Number(modelEntry.inputTokens ?? 0);
      existing.cachedInputTokens += Number(modelEntry.cachedInputTokens ?? 0);
      existing.outputTokens += Number(modelEntry.outputTokens ?? 0);
      existing.reasoningTokens += Number(modelEntry.reasoningTokens ?? 0);
      existing.totalTokens += Number(modelEntry.totalTokens ?? 0);
      existing.events += Number(modelEntry.events ?? 0);
      existing.isFallbackModel = existing.isFallbackModel || Boolean(modelEntry.isFallbackModel);
      existing.isMissingPricing = existing.isMissingPricing || Boolean(modelEntry.isMissingPricing);
      existing.isAliasPricing = existing.isAliasPricing || Boolean(modelEntry.isAliasPricing);
      existing.costBreakdownUSD.inputUSD += Number(
        (modelEntry.costBreakdownUSD as CostBreakdown | undefined)?.inputUSD ?? 0,
      );
      existing.costBreakdownUSD.cachedInputUSD += Number(
        (modelEntry.costBreakdownUSD as CostBreakdown | undefined)?.cachedInputUSD ?? 0,
      );
      existing.costBreakdownUSD.outputUSD += Number(
        (modelEntry.costBreakdownUSD as CostBreakdown | undefined)?.outputUSD ?? 0,
      );
      existing.costBreakdownUSD.totalUSD += Number(
        (modelEntry.costBreakdownUSD as CostBreakdown | undefined)?.totalUSD ?? 0,
      );
      existing.costUSD += Number(modelEntry.costUSD ?? 0);
      month.modelBreakdownIndex.set(name, existing);
    }
  }

  const rows = [...months.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, month]) => {
      const breakdown = [...month.modelBreakdownIndex.values()].sort(
        (a, b) => Number(b.totalTokens) - Number(a.totalTokens),
      );
      month.row.modelBreakdown = breakdown;
      month.row.modelTotals = Object.fromEntries(
        breakdown.map((entry) => [String(entry.name), Number(entry.totalTokens)]),
      );
      return month.row;
    });
  return rows;
}

function serializeScanStats(stats: Record<ScanKey, number>): Record<ScanKey, number> {
  return { ...stats };
}

function buildCombinedScanStats(providerReports: ProviderReport[]): Record<ScanKey, number> {
  const combined = createEmptyScanStats();
  for (const report of providerReports) {
    for (const key of SCAN_OUTPUT_KEYS) combined[key] += Number(report.scan[key] ?? 0);
  }
  return combined;
}

function buildProviderReport(
  scan: ProviderScanResult,
  pricingDataset: Record<string, Record<string, unknown>> | null,
  pricingSourceKind: string,
  pricingSourceLabel: string,
): ProviderReport {
  const allDays = [
    ...new Set([...scan.dailyUsage.keys(), ...scan.displayValuesByDay.keys()]),
  ].sort();
  const days: DailyReportRow[] = [];
  const missingPricingModels = new Set<string>();
  const costTotalsUSD: CostBreakdown = {
    inputUSD: 0,
    cachedInputUSD: 0,
    outputUSD: 0,
    totalUSD: 0,
  };

  for (const dayKey of allDays) {
    const usage = scan.dailyUsage.get(dayKey) ?? createEmptyDailyUsage();
    const modelBreakdown = Object.entries(usage.model_usage)
      .sort(([, left], [, right]) => right.total_tokens - left.total_tokens)
      .map(([name, modelUsage]) => {
        const resolved = resolveModelPricing(name, pricingDataset);
        const costBreakdownUSD = calculateCostBreakdown(modelUsage, resolved.pricing);
        if (resolved.isMissing) missingPricingModels.add(name);
        return {
          name,
          inputTokens: modelUsage.input_tokens,
          cachedInputTokens: modelUsage.cached_input_tokens,
          outputTokens: modelUsage.output_tokens,
          reasoningTokens: modelUsage.reasoning_output_tokens,
          totalTokens: modelUsage.total_tokens,
          events: modelUsage.events,
          isFallbackModel: modelUsage.is_fallback_model,
          isMissingPricing: resolved.isMissing,
          isAliasPricing: resolved.isAlias,
          resolvedPricingModel: resolved.resolvedModel,
          pricingSource: resolved.source,
          pricingPerMToken: resolved.pricing,
          costBreakdownUSD,
          costUSD: costBreakdownUSD.totalUSD,
        };
      });

    const costBreakdownUSD = modelBreakdown.reduce<CostBreakdown>(
      (acc, entry) => ({
        inputUSD: acc.inputUSD + Number(entry.costBreakdownUSD.inputUSD),
        cachedInputUSD: acc.cachedInputUSD + Number(entry.costBreakdownUSD.cachedInputUSD),
        outputUSD: acc.outputUSD + Number(entry.costBreakdownUSD.outputUSD),
        totalUSD: acc.totalUSD + Number(entry.costBreakdownUSD.totalUSD),
      }),
      { inputUSD: 0, cachedInputUSD: 0, outputUSD: 0, totalUSD: 0 },
    );

    costTotalsUSD.inputUSD += costBreakdownUSD.inputUSD;
    costTotalsUSD.cachedInputUSD += costBreakdownUSD.cachedInputUSD;
    costTotalsUSD.outputUSD += costBreakdownUSD.outputUSD;
    costTotalsUSD.totalUSD += costBreakdownUSD.totalUSD;

    days.push({
      date: dayKey,
      inputTokens: usage.input_tokens,
      cachedInputTokens: usage.cached_input_tokens,
      outputTokens: usage.output_tokens,
      reasoningTokens: usage.reasoning_output_tokens,
      totalTokens: usage.total_tokens,
      events: usage.events,
      costBreakdownUSD,
      costUSD: costBreakdownUSD.totalUSD,
      modelTotals: Object.fromEntries(
        modelBreakdown.map((entry) => [entry.name, Number(entry.totalTokens)]),
      ),
      modelBreakdown,
      displayValue: scan.displayValuesByDay.get(dayKey) ?? 0,
    });
  }

  const scanStats = serializeScanStats(scan.stats);
  scanStats.activityOnlyDays = [...scan.displayValuesByDay.keys()].filter(
    (dayKey) => !scan.dailyUsage.has(dayKey),
  ).length;

  return {
    providerId: scan.providerId,
    providerLabel: scan.providerLabel,
    providerShortLabel: scan.providerShortLabel,
    sourceHome: scan.sourceHome,
    days,
    monthly: buildMonthlyRollups(days),
    pricing: {
      source: pricingSourceKind,
      sourceLabel: pricingSourceLabel,
      url: LITELLM_PRICING_URL,
      missingModels: [...missingPricingModels].sort(),
    },
    costTotalsUSD,
    scan: scanStats,
  };
}

export function buildCombinedReport(providerReports: ProviderReport[]): ProviderReport {
  const combinedByDay = new Map<string, DailyReportRow>();
  const missingModels = new Set<string>();
  const costTotalsUSD: CostBreakdown = {
    inputUSD: 0,
    cachedInputUSD: 0,
    outputUSD: 0,
    totalUSD: 0,
  };
  const pricingSources = new Set<string>();
  const pricingLabels = new Set<string>();
  const pricingUrls = new Set<string>();

  for (const report of providerReports) {
    pricingSources.add(report.pricing.source);
    pricingLabels.add(report.pricing.sourceLabel);
    pricingUrls.add(report.pricing.url);
    for (const model of report.pricing.missingModels) missingModels.add(model);
    costTotalsUSD.inputUSD += report.costTotalsUSD.inputUSD;
    costTotalsUSD.cachedInputUSD += report.costTotalsUSD.cachedInputUSD;
    costTotalsUSD.outputUSD += report.costTotalsUSD.outputUSD;
    costTotalsUSD.totalUSD += report.costTotalsUSD.totalUSD;

    for (const day of report.days) {
      const existing =
        combinedByDay.get(day.date) ??
        ({
          date: day.date,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          events: 0,
          costBreakdownUSD: { inputUSD: 0, cachedInputUSD: 0, outputUSD: 0, totalUSD: 0 },
          costUSD: 0,
          modelTotals: {},
          modelBreakdown: [],
          displayValue: 0,
        } satisfies DailyReportRow);

      existing.inputTokens += day.inputTokens;
      existing.cachedInputTokens += day.cachedInputTokens;
      existing.outputTokens += day.outputTokens;
      existing.reasoningTokens += day.reasoningTokens;
      existing.totalTokens += day.totalTokens;
      existing.events += day.events;
      existing.displayValue += day.displayValue;
      existing.costBreakdownUSD.inputUSD += day.costBreakdownUSD.inputUSD;
      existing.costBreakdownUSD.cachedInputUSD += day.costBreakdownUSD.cachedInputUSD;
      existing.costBreakdownUSD.outputUSD += day.costBreakdownUSD.outputUSD;
      existing.costBreakdownUSD.totalUSD += day.costBreakdownUSD.totalUSD;
      existing.costUSD += day.costUSD;

      const modelIndex = new Map<string, Record<string, unknown>>(
        existing.modelBreakdown.map((entry) => [String(entry.name), entry]),
      );
      for (const modelEntry of day.modelBreakdown) {
        const name = String(modelEntry.name);
        const merged = modelIndex.get(name) ?? {
          name,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          events: 0,
          isFallbackModel: false,
          isMissingPricing: false,
          isAliasPricing: false,
          resolvedPricingModel: modelEntry.resolvedPricingModel ?? null,
          pricingSource: modelEntry.pricingSource ?? null,
          pricingPerMToken: modelEntry.pricingPerMToken ?? null,
          costBreakdownUSD: { inputUSD: 0, cachedInputUSD: 0, outputUSD: 0, totalUSD: 0 },
          costUSD: 0,
        };
        merged.inputTokens = Number(merged.inputTokens) + Number(modelEntry.inputTokens ?? 0);
        merged.cachedInputTokens =
          Number(merged.cachedInputTokens) + Number(modelEntry.cachedInputTokens ?? 0);
        merged.outputTokens = Number(merged.outputTokens) + Number(modelEntry.outputTokens ?? 0);
        merged.reasoningTokens =
          Number(merged.reasoningTokens) + Number(modelEntry.reasoningTokens ?? 0);
        merged.totalTokens = Number(merged.totalTokens) + Number(modelEntry.totalTokens ?? 0);
        merged.events = Number(merged.events) + Number(modelEntry.events ?? 0);
        merged.isFallbackModel =
          Boolean(merged.isFallbackModel) || Boolean(modelEntry.isFallbackModel);
        merged.isMissingPricing =
          Boolean(merged.isMissingPricing) || Boolean(modelEntry.isMissingPricing);
        merged.isAliasPricing =
          Boolean(merged.isAliasPricing) || Boolean(modelEntry.isAliasPricing);
        (merged.costBreakdownUSD as CostBreakdown).inputUSD += Number(
          (modelEntry.costBreakdownUSD as CostBreakdown).inputUSD,
        );
        (merged.costBreakdownUSD as CostBreakdown).cachedInputUSD += Number(
          (modelEntry.costBreakdownUSD as CostBreakdown).cachedInputUSD,
        );
        (merged.costBreakdownUSD as CostBreakdown).outputUSD += Number(
          (modelEntry.costBreakdownUSD as CostBreakdown).outputUSD,
        );
        (merged.costBreakdownUSD as CostBreakdown).totalUSD += Number(
          (modelEntry.costBreakdownUSD as CostBreakdown).totalUSD,
        );
        merged.costUSD = Number(merged.costUSD) + Number(modelEntry.costUSD ?? 0);
        merged.resolvedPricingModel ??= modelEntry.resolvedPricingModel ?? null;
        merged.pricingSource ??= modelEntry.pricingSource ?? null;
        merged.pricingPerMToken ??= modelEntry.pricingPerMToken ?? null;
        modelIndex.set(name, merged);
      }
      existing.modelBreakdown = [...modelIndex.values()].sort(
        (a, b) => Number(b.totalTokens) - Number(a.totalTokens),
      );
      existing.modelTotals = Object.fromEntries(
        existing.modelBreakdown.map((entry) => [String(entry.name), Number(entry.totalTokens)]),
      );

      combinedByDay.set(day.date, existing);
    }
  }

  const days = [...combinedByDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    providerId: COMBINED_PROVIDER_ID,
    providerLabel: COMBINED_PROVIDER_LABEL,
    providerShortLabel: COMBINED_PROVIDER_SHORT_LABEL,
    sourceHome: null,
    days,
    monthly: buildMonthlyRollups(days),
    pricing: {
      source: pricingSources.size === 1 ? [...pricingSources][0]! : "mixed",
      sourceLabel: pricingLabels.size === 1 ? [...pricingLabels][0]! : "Mixed provider pricing",
      url: pricingUrls.size === 1 ? [...pricingUrls][0]! : LITELLM_PRICING_URL,
      missingModels: [...missingModels].sort(),
    },
    costTotalsUSD,
    scan: buildCombinedScanStats(providerReports),
  };
}

export async function buildReportPayload(
  providerScans: ProviderScanResult[],
  timeZone: string,
): Promise<Record<string, unknown>> {
  let pricingDataset: Record<string, Record<string, unknown>> | null = null;
  let pricingSourceKind = "builtin-fallback";
  let pricingSourceLabel = "Built-in fallback pricing";
  try {
    pricingDataset = await fetchLiteLLMPricingDataset();
    pricingSourceKind = "litellm-live";
    pricingSourceLabel = "LiteLLM live pricing";
  } catch {
    pricingDataset = null;
  }

  const providerReports = providerScans.map((scan) =>
    buildProviderReport(scan, pricingDataset, pricingSourceKind, pricingSourceLabel),
  );
  const combined = buildCombinedReport(providerReports);
  const providers = Object.fromEntries(
    providerReports.map((report) => [report.providerId, report]),
  );
  const providerOrder = providerReports.map((report) => report.providerId);
  const defaultProvider = providerOrder[0] ?? DEFAULT_PROVIDER_ID;
  const defaultProviderReport =
    (providers[defaultProvider] as ProviderReport | undefined) ?? combined;
  const now = new Date();
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    kind: "agent-usage-report",
    timezone: timeZone,
    generatedAt: now.toISOString(),
    generatedAtDisplay: new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    })
      .format(now)
      .replace(",", ""),
    generatedLocalDate: dayKeyInTimezone(now, timeZone),
    platform: `${osPlatform()} ${osRelease()} · Node ${process.version.replace(/^v/, "")}`,
    defaultProvider,
    providerOrder,
    providerOptions: providerReports.map((report) => ({
      id: report.providerId,
      label: report.providerLabel,
      shortLabel: report.providerShortLabel,
    })),
    providers,
    combined,
    capabilities: {
      multiProvider: providerReports.length > 1,
      providerControls: providerReports.length > 1,
    },
    sourceHome: defaultProviderReport.sourceHome,
    codexHome: (providers[DEFAULT_PROVIDER_ID] as ProviderReport | undefined)?.sourceHome ?? null,
    days: defaultProviderReport.days,
    monthly: defaultProviderReport.monthly,
    pricing: defaultProviderReport.pricing,
    costTotalsUSD: defaultProviderReport.costTotalsUSD,
    scan: defaultProviderReport.scan,
  };
}

async function loadTemplate(): Promise<string> {
  return readFile(join(__dirname, "template.html"), "utf8");
}

export async function writeOutput(
  report: Record<string, unknown>,
  outputHtml: string,
  outputJson: string,
  status?: CliStatusReporter,
): Promise<void> {
  status?.step(`Writing JSON payload to ${outputJson}`);
  await writeFile(outputJson, JSON.stringify(report, null, 2), "utf8");
  status?.success(`Wrote JSON payload to ${outputJson}`);
  status?.step(`Rendering self-contained HTML report to ${outputHtml}`);
  const template = await loadTemplate();
  await writeFile(outputHtml, template.replace("__DATA__", JSON.stringify(report)), "utf8");
  status?.success(`Wrote HTML report to ${outputHtml}`);
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    codexHome: join(homedir(), ".codex"),
    claudeConfigDir: null,
    opencodeDir: null,
    piAgentDir: null,
    timezone: DEFAULT_TIMEZONE,
    outputHtml: "agent-usage-report.html",
    outputJson: "agent-usage-data.json",
    skipArchived: false,
    color: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--codex-home":
        if (!next) throw new Error("Missing value for --codex-home");
        args.codexHome = next;
        index += 1;
        break;
      case "--claude-config-dir":
        if (!next) throw new Error("Missing value for --claude-config-dir");
        args.claudeConfigDir = next;
        index += 1;
        break;
      case "--opencode-dir":
        if (!next) throw new Error("Missing value for --opencode-dir");
        args.opencodeDir = next;
        index += 1;
        break;
      case "--pi-agent-dir":
        if (!next) throw new Error("Missing value for --pi-agent-dir");
        args.piAgentDir = next;
        index += 1;
        break;
      case "--timezone":
        if (!next) throw new Error("Missing value for --timezone");
        args.timezone = next;
        index += 1;
        break;
      case "--output-html":
        if (!next) throw new Error("Missing value for --output-html");
        args.outputHtml = next;
        index += 1;
        break;
      case "--output-json":
        if (!next) throw new Error("Missing value for --output-json");
        args.outputJson = next;
        index += 1;
        break;
      case "--skip-archived":
        args.skipArchived = true;
        break;
      case "--color":
        args.color = true;
        break;
      case "--no-color":
        args.color = false;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`usage: agent-usage-report [options]

Options:
  --codex-home <path>          Path to the Codex home directory
  --claude-config-dir <paths>  Claude config dir or comma-separated dirs
  --opencode-dir <path>        OpenCode data directory
  --pi-agent-dir <path>        Pi Coding Agent dir or sessions dir
  --timezone <iana-tz>         Day bucketing timezone
  --output-html <path>         HTML output path
  --output-json <path>         JSON output path
  --color                      Force colored CLI status output
  --no-color                   Disable colored CLI status output
  --skip-archived              Skip ~/.codex/archived_sessions
  -h, --help                   Show this help text`);
}

export async function generateReport(
  args: CliArgs,
  status?: CliStatusReporter,
): Promise<Record<string, unknown>> {
  const codexHome = resolve(args.codexHome);
  if (!existsSync(codexHome))
    throw new Error(`Configured usage source does not exist: ${codexHome}`);

  const claudeConfigPaths = resolveClaudeConfigPaths(args.claudeConfigDir);
  const openCodeBaseDir = resolveOpenCodeBaseDir(args.opencodeDir);
  const piSessionsDir = resolvePiSessionsDir(args.piAgentDir);
  const claudeProjectDirs = getClaudeProjectDirs(claudeConfigPaths);
  const claudeStatsCacheFiles = getClaudeStatsCacheFiles(claudeConfigPaths);
  const claudeHistoryFiles = getClaudeHistoryFiles(claudeConfigPaths);

  const providerScans: ProviderScanResult[] = [];
  status?.step(`Scanning Codex CLI logs in ${codexHome}`);
  const codexScan = await scanCodexProvider(codexHome, !args.skipArchived, args.timezone);
  providerScans.push(codexScan);
  status?.success(formatProviderScanSummary(codexScan));

  if (
    claudeProjectDirs.length > 0 ||
    claudeStatsCacheFiles.length > 0 ||
    claudeHistoryFiles.length > 0
  ) {
    status?.step(`Scanning Claude Code data in ${summarizePaths(claudeConfigPaths)}`);
    const claudeScan = await scanClaudeProvider(claudeConfigPaths, args.timezone);
    if (providerScanHasUsage(claudeScan)) {
      providerScans.push(claudeScan);
      status?.success(formatProviderScanSummary(claudeScan));
    } else {
      status?.skip(
        `Claude Code data was found in ${summarizePaths(claudeConfigPaths)} but produced no usage rows`,
      );
    }
  } else {
    status?.skip(`Claude Code data not found in ${summarizePaths(claudeConfigPaths)}`);
  }

  if (openCodeBaseDir) {
    status?.step(`Scanning OpenCode data in ${openCodeBaseDir}`);
    const openCodeScan = await scanOpenCodeProvider(openCodeBaseDir, args.timezone);
    if (providerScanHasUsage(openCodeScan)) {
      providerScans.push(openCodeScan);
      status?.success(formatProviderScanSummary(openCodeScan));
    } else {
      status?.skip(`OpenCode data was found in ${openCodeBaseDir} but produced no usage rows`);
    }
  } else {
    status?.skip("OpenCode data not found");
  }

  if (piSessionsDir) {
    status?.step(`Scanning Pi Coding Agent sessions in ${piSessionsDir}`);
    const piScan = await scanPiProvider(piSessionsDir, args.timezone);
    if (providerScanHasUsage(piScan)) {
      providerScans.push(piScan);
      status?.success(formatProviderScanSummary(piScan));
    } else {
      status?.skip(`Pi Coding Agent data was found in ${piSessionsDir} but produced no usage rows`);
    }
  } else {
    status?.skip("Pi Coding Agent data not found");
  }

  status?.step(
    `Building combined report for ${formatCount(providerScans.length)} ${pluralize(providerScans.length, "provider")} and resolving pricing`,
  );
  const report = await buildReportPayload(providerScans, args.timezone);
  status?.success(
    `Built report payload for ${formatCount(providerScans.length)} ${pluralize(providerScans.length, "provider")}`,
  );
  return report;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseCliArgs(argv);
  const status = createCliStatusReporter(args.color);
  status.step("Preparing local agent usage report");
  status.info(`Timezone: ${args.timezone}`);
  const report = await generateReport(args, status);
  const outputHtml = resolve(args.outputHtml);
  const outputJson = resolve(args.outputJson);
  await writeOutput(report, outputHtml, outputJson, status);
  const combined = report.combined as ProviderReport;
  const primaryScan =
    (report.providers as Record<string, ProviderReport>)[DEFAULT_PROVIDER_ID]?.scan ??
    createEmptyScanStats();
  status.success("Report generation complete");
  status.info(
    `Scanned ${formatCount(primaryScan.filesScanned)} local usage ${pluralize(primaryScan.filesScanned, "file")} from ${resolve(args.codexHome)}`,
  );
  status.info(
    `Counted ${formatCount(primaryScan.tokenEventsCounted)} token ${pluralize(primaryScan.tokenEventsCounted, "event")} across ${formatCount(combined.days.length)} ${pluralize(combined.days.length, "day")}`,
  );
  status.info(
    `Total tokens in extracted dataset: ${formatCount(combined.days.reduce((sum, day) => sum + day.totalTokens, 0))}`,
  );
  status.info(`HTML report: ${outputHtml}`);
  status.info(`JSON data: ${outputJson}`);
}
