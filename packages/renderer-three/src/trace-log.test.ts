/**
 * trace-log — 结构化追踪日志工具测试
 *
 * ★ 可观测调试回路 (renderer-observability-debug-loop):
 *   验证 traceEvent 输出带稳定事件标识 (组件 + 阶段 + 失败类型) 的结构化日志,
 *   且保持旧 [Component] 前缀兼容性 (旧前缀是新前缀的头部子串)。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatTraceEvent, traceEvent } from './trace-log.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatTraceEvent — 稳定事件标识格式', () => {
  it('输出 [组件:阶段:失败类型] 前缀 + 消息', () => {
    expect(formatTraceEvent('RenderManager', 'loadScene', 'sog-fallback', 'SOG 流式加载失败')).toBe(
      '[RenderManager:loadScene:sog-fallback] SOG 流式加载失败',
    );
  });

  it('旧 [组件] 前缀是新前缀的头部子串 (向后兼容)', () => {
    const out = formatTraceEvent(
      'SogStreamer',
      'parseLodTree',
      'lod-tree-too-small',
      'LOD 树数据过小, 跳过',
    );
    expect(out.startsWith('[SogStreamer]')).toBe(false); // 结构化前缀不带旧裸前缀
    expect(out.startsWith('[SogStreamer:')).toBe(true);
    // 旧日志检索按 [SogStreamer] 过滤仍然命中 (前缀以 [SogStreamer 开头)
    expect(out.startsWith('[SogStreamer')).toBe(true);
  });
});

describe('traceEvent — 输出到 console 且携带事件标识', () => {
  it('warn 级别: console.warn 收到带稳定标识的日志', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    traceEvent(
      'RenderManager',
      'start',
      'context-lost',
      'warn',
      'WebGL context lost',
      new Error('gpu reset'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[RenderManager:start:context-lost] WebGL context lost',
      new Error('gpu reset'),
    );
  });

  it('error 级别: console.error 收到带稳定标识的日志, 透传错误对象', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('chunk load failed');
    traceEvent(
      'WebGPURenderManager',
      'loadSceneWithSog',
      'sog-chunk-error',
      'error',
      'SOG chunk 加载错误:',
      err.message,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[WebGPURenderManager:loadSceneWithSog:sog-chunk-error] SOG chunk 加载错误:',
      'chunk load failed',
    );
  });
});
