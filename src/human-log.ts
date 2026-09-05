import type { RunEvent } from "./types.js";

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
    return `[${renderClock(at)}${elapsedSuffix}] ${message}`;
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
  const detail = event.detail;
  const packetId = event.packetId ?? "";
  const message = pickString(detail, "message");
  const reason = pickString(detail, "reason");
  switch (type) {
    case "pipeline_started":
      return "流水线启动";
    case "packet_selected":
      return `选定需求包 ${packetId}`;
    case "builder_started":
      return `Builder 开始编写代码（${packetId}）`;
    case "builder_finished":
      return `Builder ${builderOutcomeText(pickString(detail, "outcome"))}（${packetId}）`;
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
      }（${packetId}）`;
    case "probe_refined":
      return `定位器已精化，重跑探针（${packetId}）`;
    case "probe_refinement_failed":
      return `定位器精化失败（${packetId}）${message ? `：${message}` : ""}`;
    case "probe_planner_retry":
      return `探针规划失败，将重试（${packetId}）${message ? `：${message}` : ""}`;
    case "probe_planner_failed":
      return `探针规划失败（${packetId}）${message ? `：${message}` : ""}`;
    case "packet_accepted":
      return `需求包验收通过（${packetId}）`;
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
      return "流水线结束";
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
  return typeof value === "string" && value.length > 0 ? value : null;
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
