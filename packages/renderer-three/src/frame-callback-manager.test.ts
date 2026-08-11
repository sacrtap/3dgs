/**
 * FrameCallbackManager 共享模块测试
 *
 * ★ M4: 验证从 RenderManager / WebGPURenderManager 提取的帧回调管理逻辑
 */

import { describe, it, expect, vi } from 'vitest';
import { FrameCallbackManager } from './frame-callback-manager.js';

describe('FrameCallbackManager', () => {
  it('注册并调用回调', () => {
    const manager = new FrameCallbackManager();
    const cb = vi.fn();
    manager.onFrame(cb);
    manager.invoke(16.67);
    expect(cb).toHaveBeenCalledWith(16.67);
  });

  it('返回注销函数', () => {
    const manager = new FrameCallbackManager();
    const cb = vi.fn();
    const unregister = manager.onFrame(cb);
    unregister();
    manager.invoke(16.67);
    expect(cb).not.toHaveBeenCalled();
  });

  it('多个回调都被调用', () => {
    const manager = new FrameCallbackManager();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();
    manager.onFrame(cb1);
    manager.onFrame(cb2);
    manager.onFrame(cb3);
    manager.invoke(33.33);
    expect(cb1).toHaveBeenCalledWith(33.33);
    expect(cb2).toHaveBeenCalledWith(33.33);
    expect(cb3).toHaveBeenCalledWith(33.33);
  });

  it('单个回调异常不影响其他回调', () => {
    const manager = new FrameCallbackManager();
    const cb1 = vi.fn(() => { throw new Error('test error'); });
    const cb2 = vi.fn();
    manager.onFrame(cb1);
    manager.onFrame(cb2);
    manager.invoke(16.67);
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });

  it('clear 清除所有回调', () => {
    const manager = new FrameCallbackManager();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    manager.onFrame(cb1);
    manager.onFrame(cb2);
    manager.clear();
    manager.invoke(16.67);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
    expect(manager.size).toBe(0);
  });

  it('size 属性返回正确数量', () => {
    const manager = new FrameCallbackManager();
    expect(manager.size).toBe(0);
    const unreg1 = manager.onFrame(() => {});
    expect(manager.size).toBe(1);
    manager.onFrame(() => {});
    expect(manager.size).toBe(2);
    unreg1();
    expect(manager.size).toBe(1);
  });

  it('同一回调注册两次, 注销一次后仍保留一次', () => {
    const manager = new FrameCallbackManager();
    const cb = vi.fn();
    manager.onFrame(cb);
    const unreg2 = manager.onFrame(cb);
    unreg2();
    manager.invoke(16.67);
    // Set 中 cb 仍存在 (因为 Set.add 是幂等的, 注册两次只存一个)
    // 注销一次后 Set.delete 返回 true, cb 被移除
    expect(cb).not.toHaveBeenCalled();
  });
});
