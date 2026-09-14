/**
 * trace-log — 结构化追踪日志工具测试
 *
 * ★ 可观测调试回路 (renderer-observability-debug-loop):
 *   验证 traceEvent 输出带稳定事件标识 (组件 + 阶段 + 失败类型) 的结构化日志,
 *   且保持旧 [Component] 前缀兼容性 (旧前缀是新前缀的头部子串)。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

describe('traceEvent 调用白名单契约 — 三个调用文件的稳定事件标识注册表', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  /** 从源文件提取所有 traceEvent 调用的 (component, stage, eventType, level) */
  function extractTraceEventCalls(filename: string): Array<[string, string, string, string]> {
    const source = readFileSync(join(here, filename), 'utf-8');
    const calls: Array<[string, string, string, string]> = [];
    // traceEvent('Component', 'stage', 'eventType', 'warn'|'error', ...)
    const re = /traceEvent\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'(warn|error)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      calls.push([m[1], m[2], m[3], m[4]]);
    }
    return calls;
  }

  // ★ 注册表 (事件白名单): 这是"官方事件集"。任何新失败分支加入 traceEvent 时
  //   必须先在此注册; 任何 eventType/level 漂移 (拼写错/级别错) 都会在这失败。
  const EVENT_REGISTRY: Record<string, Array<[string, string, string, string]>> = {
    'webgl-render-manager.ts': [
      ['RenderManager', 'start', 'context-lost', 'warn'],
      ['RenderManager', 'start', 'context-restore-reload-failed', 'error'],
      ['RenderManager', 'loadScene', 'sog-fallback', 'warn'],
      ['RenderManager', 'loadScene', 'spz-native-fallback', 'warn'],
      ['RenderManager', 'loadScene', 'truncated-fallback', 'warn'],
      ['RenderManager', 'loadSceneWithSpz', 'splat-count-over-limit', 'warn'],
      ['RenderManager', 'loadSceneWithSogFallback', 'sog-chunk-error', 'error'],
      ['RenderManager', 'addShaderInjection', 'shader-injection-overwrite', 'warn'],
      ['RenderManager', 'positionCameraToBounds', 'camera-fit-failed', 'warn'],
      ['RenderManager', 'buildLod', 'lod-build-failed', 'warn'],
      ['RenderManager', 'buildLodNonBlocking', 'lod-build-nonblocking-failed', 'warn'],
    ],
    'webgpu-render-manager.ts': [
      ['WebGPURenderManager', 'constructor', 'experimental', 'warn'],
      ['WebGPURenderManager', 'init', 'gpu-device-lost', 'error'],
      ['WebGPURenderManager', 'adjustForGpuLimits', 'max-splats-buffer-size-limit', 'warn'],
      ['WebGPURenderManager', 'adjustForGpuLimits', 'max-splats-binding-size-limit', 'warn'],
      ['WebGPURenderManager', 'loadScene', 'sog-fallback', 'warn'],
      ['WebGPURenderManager', 'loadScene', 'spz-decode-fallback', 'warn'],
      ['WebGPURenderManager', 'loadScene', 'sog-fallback-load', 'warn'],
      ['WebGPURenderManager', 'loadSceneWithSog', 'sog-chunk-error', 'error'],
      ['WebGPURenderManager', 'addShaderInjection', 'shader-injection-overwrite', 'warn'],
      ['WebGPURenderManager', 'renderLoop', 'gpu-sort-failed', 'warn'],
    ],
    'sog-streamer.ts': [
      ['SogStreamer', 'start', 'lod-fetch-fallback', 'warn'],
      ['SogStreamer', 'loadShOverlay', 'sh-overlay-size-mismatch', 'warn'],
      ['SogStreamer', 'loadShOverlay', 'sh-overlay-data-incomplete', 'warn'],
      ['SogStreamer', 'parseLodTree', 'lod-tree-too-small', 'warn'],
      ['SogStreamer', 'parseLodTree', 'lod-tree-levels-invalid', 'warn'],
      ['SogStreamer', 'parseLodTree', 'lod-tree-incomplete', 'warn'],
    ],
  };

  for (const [filename, expected] of Object.entries(EVENT_REGISTRY)) {
    it(`${filename}: ${expected.length} 处 traceEvent 调用与注册表完全一致`, () => {
      const actual = extractTraceEventCalls(filename);
      expect(actual).toEqual(expected);
    });
  }

  it('三个调用文件合计 27 处事件 (覆盖全部失败分支)', () => {
    let total = 0;
    for (const [filename, expected] of Object.entries(EVENT_REGISTRY)) {
      const actual = extractTraceEventCalls(filename);
      total += actual.length;
      expect(actual.length).toBe(expected.length);
    }
    expect(total).toBe(27);
  });

  it('所有 eventType 标识符合 kebab-case 稳定命名 (契约可检索性)', () => {
    for (const [filename] of Object.entries(EVENT_REGISTRY)) {
      for (const [, , eventType] of extractTraceEventCalls(filename)) {
        expect(eventType).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
    }
  });
});
