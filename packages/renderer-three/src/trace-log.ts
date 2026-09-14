/**
 * 结构化追踪日志（可观测调试回路）
 *
 * 关键失败路径的可观测性: 降级/失败分支不再裸用 console.warn/error,
 * 而是通过 traceEvent 输出带稳定事件标识的结构化日志, 便于测试断言、
 * 日志检索与监控告警。
 *
 * 输出格式: [Component:stage:eventType] message ...
 * - Component  渲染器组件名 (RenderManager / WebGPURenderManager / SogStreamer)
 * - stage      失败所在阶段 (loadScene / loadShOverlay / buildLod ...)
 * - eventType  稳定失败类型标识 (context-lost / sog-fallback / size-mismatch ...)
 *
 * 兼容性: 旧前缀 [RenderManager] 是新前缀 [RenderManager:loadScene:sog-fallback]
 * 的头部子串, 既有的日志检索/CI 输出按组件名过滤仍可用。
 */

export type TraceLevel = 'warn' | 'error';

/** 无副作用的格式化纯函数, 供测试与统一输出 */
export function formatTraceEvent(
  component: string,
  stage: string,
  eventType: string,
  message: string,
): string {
  return `[${component}:${stage}:${eventType}] ${message}`;
}

/**
 * 输出带稳定事件标识的结构化日志。
 * @param component 渲染器组件名
 * @param stage     失败所在阶段
 * @param eventType 稳定失败类型标识
 * @param level     日志级别, 默认 warn
 * @param message   人类可读消息
 * @param args      附加上下文 (错误对象等), 原样透传
 */
export function traceEvent(
  component: string,
  stage: string,
  eventType: string,
  level: TraceLevel,
  message: string,
  ...args: unknown[]
): void {
  const prefix = formatTraceEvent(component, stage, eventType, message);
  if (level === 'error') {
    console.error(prefix, ...args);
  } else {
    console.warn(prefix, ...args);
  }
}
