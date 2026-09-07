import type { RunEvent } from "./types.js";
import { sanitizeDiagnosticText } from "./diagnostics.js";

export class HumanRunFormatter {
  private firstAtMs: number | null = null;

  format(rawLine: string): string | null {
    const event = parseEvent(rawLine);
    if (!event) return null;
    const at = typeof event.at === "string" ? Date.parse(event.at) : Number.NaN;
    const elapsed = this.trackElapsed(at);
    const message = describe(event.type, event);
    if (message === null) return null;
    const elapsedSuffix = elapsed === null ? "" : ` +${elapsed}`;
    const context = event.sequence ? ` [#${event.sequence}${event.attempt ? ` 尝试 ${event.attempt}` : ""}]` : "";
    const duration = pickNumber(event.detail, "durationMs");
    const durationText = duration === null ? "" : `；本阶段耗时 ${renderDuration(duration)}`;
    return `[${renderClock(at)}${elapsedSuffix}] ${message.replace(/[\r\n]+/g, " ↵ ")}${durationText}${context}`;
  }

  private trackElapsed(atMs: number): string | null {
    if (!Number.isFinite(atMs)) return null;
    if (this.firstAtMs === null) {
      this.firstAtMs = atMs;
      return "0s";
    }
    return renderDuration(atMs - this.firstAtMs);
  }
}

function plannerFailureText(detail: RunEvent["detail"]): string {
  const message = pickString(detail, "message");
  const category = pickString(detail, "category");
  const validationError = pickString(detail, "validationError");
  return `${category ? ` [${category}]` : ""}${message ? `：${message}` : ""}${
    validationError ? `；原因：${validationError}` : ""
  }`;
}

function parseEvent(rawLine: string): RunEvent | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<RunEvent>;
  if (typeof candidate.type !== "string") return null;
  return value as RunEvent;
}

function describe(type: string, event: RunEvent): string | null {
  const detail: Record<string, unknown> | undefined = event.detail;
  const packetId = event.packetId ?? "";
  const message = pickString(detail, "message");
  const reason = pickString(detail, "reason");
  switch (type) {
    case "pipeline_started":
      return `流水线启动${detail ? `；原子需求 ${pickNumber(detail, "requirements") ?? "未知"}；预算 ${detail.totalBudgetMs === 0 ? "不限时" : renderDuration(pickNumber(detail, "totalBudgetMs") ?? 0)}；探针端口 ${pickNumber(detail, "port") ?? "未知"}${pickString(detail, "model") ? `；模型 ${pickString(detail, "model")}` : ""}` : ""}`;
    case "packet_selected":
      return `选定需求包 ${packetId}${strings(detail?.names).length ? `：${strings(detail?.names).join("、")}` : ""}`;
    case "builder_started":
      return `Builder 开始编写代码（${packetId}）`;
    case "builder_finished":
      return `Builder ${builderOutcomeText(pickString(detail, "outcome"))}（${packetId}）${pickString(detail, "summary") ? `；自述回执（非验收）：${pickString(detail, "summary")}` : ""}`;
    case "probe_planning":
      return `开始规划黑盒探针（${packetId}）`;
    case "application_starting":
      return `开始启动候选应用（${packetId}）`;
    case "application_ready":
      return `候选应用已就绪（${packetId}）：${pickString(detail, "baseUrl") ?? ""}`;
    case "application_stopped":
      return `候选应用已停止（${packetId}）`;
    case "probe_started":
      return `开始执行 ${pickNumber(detail, "cases") ?? 0} 个黑盒探针（${packetId}）；基础设施重试 ${pickNumber(detail, "retryCount") ?? 0}`;
    case "repair_scheduled":
      return `安排第 ${pickNumber(detail, "nextAttempt")} 次 Builder 尝试（${packetId}），${detail?.rootCauseFirst ? "先分析根因再修复" : "依据失败观测修复"}；失败分类：${strings(detail?.failures).join("、")}`;
    case "verification_started":
      return `开始交付验证（安装→构建→启动→健康检查→浏览器冒烟）；基础设施重试 ${pickNumber(detail, "retryCount") ?? 0}`;
    case "verification_finished":
      return `交付验证${detail?.ok ? "通过" : "失败"}；阶段 ${pickString(detail, "stage")}${message ? `：${message}` : ""}`;
    case "arc_projection_failed":
      return `ARC 平台投影写入失败，内部判定保持不变${message ? `：${message}` : ""}`;
    case "evidence_write_failed":
      return `失败证据保存失败（${packetId}），继续依据现有判词决策`;
    case "builder_reference_images": {
      const mode = pickString(detail, "mode");
      const skipped = Array.isArray(detail?.skipped) ? detail.skipped.length : 0;
      const description = mode === "text_fallback" ? "图片输入不受支持，已回退纯文本"
        : mode === "attached" ? `发送 ${pickNumber(detail, "attachedCount") ?? 0} 张参考图片`
        : "参考图片不可用，按文字继续";
      return `${description}（${packetId}）；跳过 ${skipped} 项`;
    }
    case "probe_planned": {
      const cases = pickNumber(detail, "cases");
      return cases === null
        ? `探针用例已生成（${packetId}）`
        : `已生成 ${cases} 个探针用例（${packetId}）`;
    }
    case "application_start_failed":
      return `应用启动失败（${packetId}）${message ? `：${message}` : ""}`;
    case "probe_finished":
      return `探针${verdictText(pickString(detail, "verdict"))}${
        detail?.refined === true ? "（精化后重跑）" : ""
      }（${packetId}）${typeof detail?.passed === "number" ? `；通过 ${detail.passed} / 失败 ${detail.failed}；失败分类 ${strings(detail.categories).join("、") || "无"}` : ""}${pickString(detail, "evidenceId") ? `；私有证据 ${pickString(detail, "evidenceId")}` : ""}`;
    case "probe_refined":
      return `定位器已精化，重跑探针（${packetId}）`;
    case "probe_refinement_failed":
      return `定位器精化失败（${packetId}）${plannerFailureText(detail)}`;
    case "probe_planner_retry":
      return `探针规划失败，将重试（${packetId}）${plannerFailureText(detail)}`;
    case "probe_planner_failed":
      return `探针规划失败（${packetId}）${plannerFailureText(detail)}`;
    case "execution_fault":
      return `执行基础设施故障（${packetId}，${pickString(detail, "source")} / ${pickString(detail, "code")}），${
        detail?.retry === true ? "保持候选和计划，重试一次" : "停止当前执行"
      }；Builder 尝试 ${pickNumber(detail, "attempt") ?? 0}`;
    case "packet_accepted":
      return `需求包验收通过（${packetId}）${event.acceptedSha ? `；接受 SHA ${event.acceptedSha}` : ""}`;
    case "packet_blocked":
      return `需求包已阻塞并回滚（${packetId}）${reason ? `：${reason}` : ""}`;
    case "delivery_started":
      return "进入交付窗口，开始最终验收";
    case "delivery_repair_started":
      return `最终验收未通过（${pickString(detail, "stage")}），启动交付修复${
        message ? `：${message}` : ""
      }`;
    case "delivery_repair_accepted":
      return "交付修复验收通过";
    case "delivery_repair_restored":
      return "交付修复未被接受，已恢复最后接受状态";
    case "pipeline_failed":
      return `流水线异常退出，已回滚${message ? `：${message}` : ""}`;
    case "delivery_finished": {
      const stage = pickString(detail, "stage");
      const stageSuffix = stage ? `（${stage}）` : "";
      return detail?.ok === true
        ? `交付完成${stageSuffix}`
        : `交付失败${stageSuffix}${message ? `：${message}` : ""}`;
    }
    case "pipeline_finished":
      return `流水线结束${detail ? `；结果 ${pickString(detail, "status")}；已验证 ${strings(detail.verifiedRequirementIds).length}，阻塞 ${strings(detail.blockedRequirementIds).length}，待处理 ${strings(detail.pendingRequirementIds).length}；阻塞 ID：${strings(detail.blockedRequirementIds).join("、") || "无"}；待处理 ID：${strings(detail.pendingRequirementIds).join("、") || "无"}；接受 SHA ${pickString(detail, "acceptedSha")}` : ""}`;
    default:
      return null;
  }
}

function builderOutcomeText(outcome: string | null): string {
  if (outcome === "completed") return "完成";
  if (outcome === "timed_out") return "超时";
  if (outcome === "failed") return "失败";
  return outcome ? `结束于 ${outcome}` : "结束";
}

function verdictText(verdict: string | null): string {
  if (verdict === "pass") return "通过";
  if (verdict === "fail") return "失败";
  if (verdict === "inconclusive") return "无法定论";
  return `结果 ${verdict ?? "未知"}`;
}

function pickString(detail: Record<string, unknown> | undefined, key: string): string | null {
  const value = detail?.[key];
  return typeof value === "string" && value.length > 0 ? sanitizeDiagnosticText(value) : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => sanitizeDiagnosticText(item)) : [];
}

function pickNumber(detail: Record<string, unknown> | undefined, key: string): number | null {
  const value = detail?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function renderClock(atMs: number): string {
  if (!Number.isFinite(atMs)) return "--:--:--";
  const moment = new Date(atMs);
  const hh = String(moment.getHours()).padStart(2, "0");
  const mm = String(moment.getMinutes()).padStart(2, "0");
  const ss = String(moment.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function renderDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds}s`;
}
