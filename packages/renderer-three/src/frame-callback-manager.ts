/**
 * FrameCallbackManager — 帧回调管理共享模块
 *
 * ★ M4: 从 RenderManager 和 WebGPURenderManager 提取的共享逻辑
 *
 * 功能:
 *   1. 注册/注销每帧回调 (onFrame API)
 *   2. 安全调用所有回调 (异常隔离, 单个回调出错不影响其他)
 *   3. 清理所有回调 (destroy 时)
 *
 * 使用方式 (组合模式):
 * ```typescript
 * const cbManager = new FrameCallbackManager();
 * const unregister = cbManager.onFrame((dt) => { ... });
 * // 每帧:
 * cbManager.invoke(deltaTime);
 * // 注销:
 * unregister();
 * // 或销毁:
 * cbManager.clear();
 * ```
 *
 * [来源: M4 重构 — 从 index.ts + webgpu-render-manager.ts 提取]
 */

export type FrameCallback = (deltaTime: number) => void;

export class FrameCallbackManager {
  private callbacks = new Set<FrameCallback>();

  /**
   * 注册帧回调
   *
   * @returns 注销函数 (调用后移除该回调)
   */
  onFrame(callback: FrameCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * 调用所有帧回调 (异常隔离)
   *
   * @param deltaTime 帧间隔 (毫秒)
   */
  invoke(deltaTime: number): void {
    for (const cb of this.callbacks) {
      try {
        cb(deltaTime);
      } catch {
        /* 安全: 单个回调出错不影响其他 */
      }
    }
  }

  /** 清除所有回调 */
  clear(): void {
    this.callbacks.clear();
  }

  /** 当前注册的回调数量 */
  get size(): number {
    return this.callbacks.size;
  }
}
