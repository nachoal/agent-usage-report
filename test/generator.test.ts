import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCombinedReport,
  buildMonthlyRollups,
  generateReport,
  parseCliArgs,
} from "../src/generator.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("parseCliArgs", () => {
  it("parses explicit CLI flags", () => {
    const args = parseCliArgs([
      "--codex-home",
      "/tmp/codex",
      "--claude-config-dir",
      "/tmp/claude",
      "--opencode-dir",
      "/tmp/opencode",
      "--pi-agent-dir",
      "/tmp/pi",
      "--timezone",
      "UTC",
      "--output-html",
      "report.html",
      "--output-json",
      "report.json",
      "--color",
      "--skip-archived",
    ]);

    expect(args.codexHome).toBe("/tmp/codex");
    expect(args.claudeConfigDir).toBe("/tmp/claude");
    expect(args.opencodeDir).toBe("/tmp/opencode");
    expect(args.piAgentDir).toBe("/tmp/pi");
    expect(args.timezone).toBe("UTC");
    expect(args.outputHtml).toBe("report.html");
    expect(args.outputJson).toBe("report.json");
    expect(args.skipArchived).toBe(true);
    expect(args.color).toBe(true);
  });

  it("accepts --no-color", () => {
    const args = parseCliArgs(["--no-color"]);

    expect(args.color).toBe(false);
  });
});

describe("buildMonthlyRollups", () => {
  it("groups daily rows by month and ignores zero-token display-only rows", () => {
    const monthly = buildMonthlyRollups([
      {
        date: "2026-01-01",
        inputTokens: 100,
        cachedInputTokens: 10,
        outputTokens: 20,
        reasoningTokens: 0,
        totalTokens: 120,
        events: 1,
        costBreakdownUSD: { inputUSD: 1, cachedInputUSD: 0.1, outputUSD: 0.2, totalUSD: 1.3 },
        costUSD: 1.3,
        modelTotals: { a: 120 },
        modelBreakdown: [
          {
            name: "a",
            inputTokens: 100,
            cachedInputTokens: 10,
            outputTokens: 20,
            reasoningTokens: 0,
            totalTokens: 120,
            events: 1,
            isFallbackModel: false,
            isMissingPricing: false,
            isAliasPricing: false,
            resolvedPricingModel: "a",
            pricingSource: "builtin",
            pricingPerMToken: {},
            costBreakdownUSD: { inputUSD: 1, cachedInputUSD: 0.1, outputUSD: 0.2, totalUSD: 1.3 },
            costUSD: 1.3,
          },
        ],
        displayValue: 0,
      },
      {
        date: "2026-01-02",
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
        displayValue: 5,
      },
    ]);

    expect(monthly).toHaveLength(1);
    expect(monthly[0]?.month).toBe("2026-01");
    expect(monthly[0]?.totalTokens).toBe(120);
    expect(monthly[0]?.activeDays).toBe(1);
  });
});

describe("buildCombinedReport", () => {
  it("merges provider daily rows and display values", () => {
    const combined = buildCombinedReport([
      {
        providerId: "codex",
        providerLabel: "Codex",
        providerShortLabel: "Codex",
        sourceHome: "/tmp/codex",
        days: [
          {
            date: "2026-01-01",
            inputTokens: 100,
            cachedInputTokens: 0,
            outputTokens: 20,
            reasoningTokens: 0,
            totalTokens: 120,
            events: 1,
            costBreakdownUSD: { inputUSD: 1, cachedInputUSD: 0, outputUSD: 0.2, totalUSD: 1.2 },
            costUSD: 1.2,
            modelTotals: {},
            modelBreakdown: [],
            displayValue: 0,
          },
        ],
        monthly: [],
        pricing: { source: "builtin", sourceLabel: "Builtin", url: "x", missingModels: [] },
        costTotalsUSD: { inputUSD: 1, cachedInputUSD: 0, outputUSD: 0.2, totalUSD: 1.2 },
        scan: {
          filesScanned: 1,
          jsonlFilesScanned: 1,
          jsonFilesScanned: 0,
          parseErrors: 0,
          nullInfoEventsSkipped: 0,
          duplicateEventsSkipped: 0,
          syntheticEventsSkipped: 0,
          zeroTotalEventsSkipped: 0,
          tokenEventsCounted: 1,
          unsupportedLegacyFiles: 0,
          activityOnlyDays: 0,
        },
      },
      {
        providerId: "claude",
        providerLabel: "Claude",
        providerShortLabel: "Claude",
        sourceHome: "/tmp/claude",
        days: [
          {
            date: "2026-01-01",
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
            displayValue: 3,
          },
        ],
        monthly: [],
        pricing: { source: "builtin", sourceLabel: "Builtin", url: "x", missingModels: [] },
        costTotalsUSD: { inputUSD: 0, cachedInputUSD: 0, outputUSD: 0, totalUSD: 0 },
        scan: {
          filesScanned: 1,
          jsonlFilesScanned: 1,
          jsonFilesScanned: 0,
          parseErrors: 0,
          nullInfoEventsSkipped: 0,
          duplicateEventsSkipped: 0,
          syntheticEventsSkipped: 0,
          zeroTotalEventsSkipped: 0,
          tokenEventsCounted: 0,
          unsupportedLegacyFiles: 0,
          activityOnlyDays: 1,
        },
      },
    ] as never);

    expect(combined.days).toHaveLength(1);
    expect(combined.days[0]?.totalTokens).toBe(120);
    expect(combined.days[0]?.displayValue).toBe(3);
    expect(combined.scan.activityOnlyDays).toBe(1);
  });
});

describe("generateReport", () => {
  it("builds a provider-aware report from local fixture data", async () => {
    const root = await createTempDir("agent-usage-data-");
    const codexHome = join(root, "codex");
    const claudeBase = join(root, "claude");
    const opencodeBase = join(root, "opencode");
    const piBase = join(root, "pi");

    await mkdir(join(codexHome, "sessions"), { recursive: true });
    await mkdir(join(claudeBase, "projects", "sample"), { recursive: true });
    await mkdir(join(opencodeBase, "storage", "message", "s1"), { recursive: true });
    await mkdir(join(piBase, "sessions", "proj"), { recursive: true });

    await writeFile(
      join(codexHome, "sessions", "sample.jsonl"),
      [
        JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.4" }, timestamp: "2026-01-01T00:00:00Z" }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-01-01T01:00:00Z",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 50,
                output_tokens: 20,
                reasoning_output_tokens: 0,
                total_tokens: 120,
              },
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      join(claudeBase, "projects", "sample", "sample.jsonl"),
      JSON.stringify({
        timestamp: "2026-01-02T00:00:00Z",
        requestId: "req1",
        message: {
          id: "msg1",
          model: "claude-sonnet-4-5",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 2,
          },
        },
      }),
      "utf8",
    );

    await writeFile(
      join(claudeBase, "history.jsonl"),
      JSON.stringify({
        timestamp: Date.parse("2025-10-01T00:00:00Z"),
        project: "/tmp/project",
      }),
      "utf8",
    );

    await writeFile(
      join(opencodeBase, "storage", "message", "s1", "m1.json"),
      JSON.stringify({
        id: "m1",
        providerID: "openai",
        modelID: "gpt-5.4",
        time: { created: Date.parse("2026-01-03T00:00:00Z") },
        tokens: { input: 8, output: 4, cache: { read: 2, write: 1 } },
      }),
      "utf8",
    );

    await writeFile(
      join(piBase, "sessions", "proj", "s1.jsonl"),
      JSON.stringify({
        type: "message",
        timestamp: "2026-01-04T00:00:00Z",
        message: {
          role: "assistant",
          model: "claude-opus-4-1",
          usage: { input: 6, output: 3, cacheRead: 1, cacheWrite: 2 },
        },
      }),
      "utf8",
    );

    const report = (await generateReport({
      codexHome,
      claudeConfigDir: claudeBase,
      opencodeDir: opencodeBase,
      piAgentDir: piBase,
      timezone: "UTC",
      outputHtml: join(root, "report.html"),
      outputJson: join(root, "report.json"),
      skipArchived: true,
    })) as any;

    expect(report.providerOrder).toEqual(["codex", "claude", "opencode", "pi"]);
    expect(report.providers.codex.days).toHaveLength(1);
    expect(report.providers.claude.days[0].date).toBe("2025-10-01");
    expect(report.providers.claude.days[0].displayValue).toBe(1);
    expect(report.providers.opencode.days).toHaveLength(1);
    expect(report.providers.pi.days).toHaveLength(1);
    expect(report.combined.days).toHaveLength(5);
  });
});
