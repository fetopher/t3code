// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off -- Short-lived, bounded CLI probes at the native adapter boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MenuBarUsageRow, ServerProviderUsageLimits } from "@t3tools/contracts";
import { evenPaceRemainingPercent } from "@t3tools/shared/usageLimits";
import { claudeUsageResponseToLimits } from "../../../server/src/provider/claudeUsageLimits.ts";
import {
  codexRateLimitsToLimits,
  type CodexRateLimitSnapshot,
} from "../../../server/src/provider/codexUsageLimits.ts";

interface ProviderConfiguration {
  binaryPath?: string;
  homePath?: string;
}
interface StandardSettings {
  providers?: Record<string, ProviderConfiguration & { enabled?: boolean }>;
  providerInstances?: Record<
    string,
    { driver: string; enabled?: boolean; config?: ProviderConfiguration }
  >;
}

const expand = (value: string) =>
  value.startsWith("~/") ? NodePath.join(NodeOS.homedir(), value.slice(2)) : value;

function rowsFromLimits(
  provider: string,
  label: string,
  limits: ServerProviderUsageLimits,
): MenuBarUsageRow[] {
  return limits.windows.map((window) => ({
    provider,
    label,
    window: window.label,
    remainingPercent: Math.max(0, Math.min(100, 100 - window.usedPercent)),
    checkedAt: limits.checkedAt,
    resetsAt: window.resetsAt ?? null,
    expectedRemainingPercent: evenPaceRemainingPercent([window], Date.now()),
    ...(window.windowDurationMins ? { windowDurationMins: window.windowDurationMins } : {}),
  }));
}

async function claudeLimits(config: ProviderConfiguration): Promise<ServerProviderUsageLimits> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 25_000);
  const binary = config.binaryPath?.trim() || "claude";
  // The SDK's native executable mode needs an absolute path; resolve using our explicit PATH.
  let q: ReturnType<typeof query> | undefined;
  try {
    const executable = NodePath.isAbsolute(expand(binary))
      ? expand(binary)
      : await findExecutable(binary);
    q = query({
      // No user prompt or model turn is ever sent by this usage probe.
      // oxlint-disable-next-line require-yield
      prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
        await new Promise<void>((resolve) => {
          if (abort.signal.aborted) resolve();
          else abort.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      })(),
      options: {
        pathToClaudeCodeExecutable: executable,
        abortController: abort,
        persistSession: false,
        cwd: NodeOS.homedir(),
        settingSources: [],
        settings: { disableAllHooks: true },
        allowedTools: [],
        mcpServers: {},
        strictMcpConfig: true,
        env: {
          ...process.env,
          ENABLE_CLAUDEAI_MCP_SERVERS: "false",
          CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
          ...(config.homePath ? { CLAUDE_CONFIG_DIR: expand(config.homePath) } : {}),
        },
        stderr: () => {},
      },
    });
    await q.initializationResult();
    const usage = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    });
    return claudeUsageResponseToLimits({ response: usage, checkedAt: new Date().toISOString() })
      .limits;
  } finally {
    clearTimeout(timer);
    abort.abort();
    q?.close();
  }
}

async function findExecutable(binary: string): Promise<string> {
  const { access } = await import("node:fs/promises");
  for (const directory of (process.env.PATH ?? "").split(":")) {
    const candidate = NodePath.join(directory, binary);
    try {
      await access(candidate, 1);
      return candidate;
    } catch {
      /* Try the next PATH entry. */
    }
  }
  throw new Error("CLI not installed");
}

async function codexLimits(config: ProviderConfiguration): Promise<ServerProviderUsageLimits> {
  const child = NodeChildProcess.spawn(
    expand(config.binaryPath?.trim() || "codex"),
    ["app-server"],
    {
      cwd: NodeOS.homedir(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(config.homePath ? { CODEX_HOME: expand(config.homePath) } : {}) },
    },
  );
  const lines = NodeReadline.createInterface({ input: child.stdout });
  let requestId = 0;
  const waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const fail = () => {
    for (const pending of waiting.values()) pending.reject(new Error("Usage probe unavailable"));
    waiting.clear();
  };
  child.on("error", fail);
  child.on("exit", fail);
  child.stderr.resume();
  child.stdin.on("error", fail);
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
      if (message.id === undefined) return;
      const pending = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) pending?.reject(new Error("Usage probe rejected"));
      else pending?.resolve(message.result);
    } catch {
      /* CLI diagnostics are not protocol responses. */
    }
  });
  const request = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++requestId;
      waiting.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  const timer = setTimeout(() => {
    fail();
    child.kill();
  }, 25_000);
  try {
    await request("initialize", {
      clientInfo: { name: "t3-menubar-companion", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    const result = (await request("account/rateLimits/read", null)) as {
      rateLimits: CodexRateLimitSnapshot;
      rateLimitsByLimitId?: Record<string, CodexRateLimitSnapshot>;
    };
    return codexRateLimitsToLimits({
      snapshot: result.rateLimits,
      rateLimitsByLimitId: result.rateLimitsByLimitId ?? null,
      checkedAt: new Date().toISOString(),
    });
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.end();
    child.kill();
  }
}

export async function readCompanionUsage(stateDir: string) {
  let settings: StandardSettings = {};
  try {
    settings = JSON.parse(
      await NodeFSP.readFile(NodePath.join(stateDir, "settings.json"), "utf8"),
    ) as StandardSettings;
  } catch {
    /* Default CLI login profiles. */
  }
  const instances = Object.entries(settings.providerInstances ?? {}).filter(
    ([, item]) => item.enabled !== false,
  );
  const providers = [
    { id: "claudeAgent", label: "Claude", probe: claudeLimits },
    { id: "codex", label: "Codex", probe: codexLimits },
  ].filter(({ id }) => settings.providers?.[id]?.enabled !== false);
  const results = await Promise.all(
    providers.map(async (provider) => {
      const instance = instances.find(([, item]) => item.driver === provider.id);
      const config = instance?.[1].config ?? settings.providers?.[provider.id] ?? {};
      try {
        return {
          rows: rowsFromLimits(provider.id, provider.label, await provider.probe(config)),
          notice: null,
        };
      } catch {
        return {
          rows: [] as MenuBarUsageRow[],
          notice: `${provider.label} usage unavailable. Check its CLI login.`,
        };
      }
    }),
  );
  return {
    rows: results.flatMap((result) => result.rows),
    notices: results.flatMap((result) => (result.notice ? [result.notice] : [])),
  };
}
