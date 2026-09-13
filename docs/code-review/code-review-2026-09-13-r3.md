{
 "status": "complete",
 "llm": {
  "provider": "bifrost",
  "model": "qwen3.7-plus"
 },
 "message": "Review complete: 5 finding(s) across 10 selected item(s).",
 "summary": {
  "files_reviewed": 10,
  "comments": 5,
  "total_tokens": 822225,
  "input_tokens": 798846,
  "output_tokens": 23379,
  "cache_read_tokens": 676736,
  "elapsed": "6m51s"
 },
 "tool_calls": {
  "total": 58,
  "by_tool": {
   "code_comment": 2,
   "code_search": 17,
   "file_find": 2,
   "file_read": 37
  },
  "failure": 0,
  "failure_by_tool": {},
  "failure_details": []
 },
 "comments": [
  {
   "path": "apps/demo/src/main.ts",
   "content": "建议将 `sceneIds.length * formats.length` 提取为局部变量（例如 `const total = sceneIds.length * formats.length`），避免在 4 处重复计算同一表达式。这样既提高可读性，也便于后续若 `sceneIds` 或 `formats` 变化时只需修改一处。",
   "suggestion_code": "          if (onProgress) onProgress(results.length, total, scene.title, format, 'skipped');",
   "existing_code": "          if (onProgress) onProgress(results.length, sceneIds.length * formats.length, scene.title, format, 'skipped');",
   "start_line": 1065,
   "end_line": 1065,
   "thinking": "Now I have a good understanding of the changes. Let me summarize:\n\n1. **Null guard for `renderer`**: `renderer` is declared as `let renderer = null` at line 24, and can be set to `null` at line 906 when renderer initialization fails. The null guard in `__getDeviceInfo` is correct and necessary.\n\n2. **Hardcoded `18` → `sceneIds.length * formats.length`**: The total benchmark count was hardcoded to `18`, but `sceneIds.length * formats.length = 5 * 4 = 20`. This was actually a bug (hardcoded wrong value). The fix is correct.\n\n\n3. **Repetition of `sceneIds.length * formats.length`**: This expression appears 4 times throughout the code, and while extracting it to a variable would improve maintainability, it's a minor style concern. I'm also noticing a potential null reference issue where `scene` could be undefined at line 1058, but the code accesses `scene.title` without a null check at lines 1062-1063, which could cause a runtime error.\n\nHowever, since that's pre-existing code outside the scope of this diff, I'll focus on the actual changes. The main thing worth flagging is that `sceneIds.length * formats.length` is computed repeatedly even though both arrays are constants and the value never changes—extracting it to a `totalBenchmarks` variable would be a clean improvement.",
   "category": "maintainability",
   "severity": "low"
  },
  {
   "path": "apps/demo/src/main.ts",
   "content": "此处新增了 `renderer` 的空值守卫（注释也明确说明 \"renderer 可能为 null\"），但在同文件第 1114 行 `window.__getMediaPose = () => extractCameraPose(renderer.getViewProjectionMatrix())` 以及第 338 行 `cameraForwardPoint` 函数中，`renderer` 仍然被直接访问而未做空值检查。既然已经承认 `renderer` 可能为 null，建议在这些位置也保持一致加上空值守卫，否则在 renderer 为 null 的场景下这些调用同样会抛出 TypeError。",
   "existing_code": "      deviceTier: renderer ? tierNames[renderer.getDeviceTier()] : 'N/A',",
   "start_line": 977,
   "end_line": 977,
   "thinking": "Line 1114 calls `renderer.getViewProjectionMatrix()` without a null check. Since the PR explicitly acknowledges that `renderer` can be null (the comment says \"renderer 可能为 null\"), this is an inconsistency. The same function `__getDeviceInfo` now guards against null `renderer`, but `__getMediaPose` at line 1114 does not.\n\nHowever, line 1114 is not part of the diff changes. It's existing code. But the PR's changes make this inconsistency more apparent. Since the PR is adding null guards for `renderer`, it should be consistent.\n\nActually, looking more carefully at the diff, lines 1114 is within the scope of the file but not changed. \n\nThe new null guard pattern in `__getDeviceInfo` creates an inconsistency with line 1114, which accesses `renderer` without protection. Since this is the same PR introducing the null-safety concept, I should flag this as a related issue that needs addressing for consistency.",
   "category": "bug",
   "severity": "medium"
  },
  {
   "path": "packages/renderer-three/src/webgl-render-manager.ts",
   "content": "**竞态条件**: `onStreamer` 回调已经提前设置了 `this._sogStreamer = streamer`，而此处 `loadSogChunks` 返回后又重复赋值。当 `loadSogChunks` 被 abort 后（`start()` 对 abort 不抛异常，正常 resolve），这行代码会用**已过期的旧 streamer** 覆盖新 `loadScene` 设置的 streamer。\n\n竞态时序：\n1. `loadScene('A')` → `loadSceneWithSog` → `loadSogChunks(A)` 开始，`onStreamer` 设置 `_sogStreamer = streamerA`\n2. `await streamerA.start()` 期间，`loadScene('B')` 被调用\n3. `loadScene('B')`: `streamerA.abort()` → `_sogStreamer = undefined` → `loadSceneWithSog(B)` → `onStreamer` 设置 `_sogStreamer = streamerB`\n4. 旧的 `loadSogChunks(A)` resolve（abort 后 `start()` 正常返回）→ **此行将 `_sogStreamer` 覆写为已废弃的 streamerA**\n5. 后续 `destroy()` 或新的 `loadScene` 会 abort streamerA 而非 streamerB，streamerB 泄漏\n\n建议：既然 `onStreamer` 已负责提前赋值，应**删除**此处的重复赋值，避免迟到 resolve 覆盖新引用。",
   "suggestion_code": "    // ★ onStreamer 回调已提前赋值; 此处不再赋值, 避免 abort 后迟到 resolve 覆盖新 streamer",
   "existing_code": "    this._sogStreamer = streamer;",
   "start_line": 876,
   "end_line": 876,
   "thinking": "Now I have a clear picture. The race condition exists in both render managers. Let me formulate my feedback.\n\nThe core issue is:\n\n1. `onStreamer` callback sets `this._sogStreamer = streamer` early (before `await streamer.start()`)\n2. The original `this._sogStreamer = streamer` still exists after `loadSogChunks` returns\n3. If the streamer is aborted (by a new `loadScene` or `destroy`) during `await streamer.start()`:\n   - `abort()` sets `aborted = true` and cancels fetch requests\n   - `start()` returns normally (doesn't throw for abort)\n   - `loadSogChunks` resolves with partial data\n   - The code after `loadSogChunks` runs, including `this._sogStreamer = streamer`\n   - This overwrites whatever new `_sogStreamer` was set by the new `loadScene`\n\nThe fix is to remove the redundant `this._sogStreamer = streamer` assignment after `loadSogChunks` since `onStreamer` already handles it. But there's a deeper issue: even with `onStreamer`, the stale `loadSogChunks` continues running after abort and eventually resolves, causing the same overwrite problem.\n\nActually, let me trace through the timeline more carefully. When `loadScene('B')` is called, it immediately aborts the old streamer and clears `_sogStreamer` before starting the new load, so by the time the stale `loadSogChunks` resolves, the new streamer is already in place. The real issue is that the old code's assignment after `loadSogChunks` was the only way `_sogStreamer` got set, so removing it without ensuring `onStreamer` fires reliably would leave it undefined. Looking at the execution flow, I can see the race condition clearly: when streamer A's chunks finish loading and resolve, it overwrites `_sogStreamer` with the stale streamer A, even though streamer B is now the active one. The problem is that both the `onStreamer` callback and the original assignment at line 880 execute, with the latter clobbering the former's reference.\n\nThe real issue is that the old code never set `_sogStreamer` until after `loadSogChunks` completed, so a `destroy()` call during the await would leave nothing to abort. But the new approach of setting it early via `onStreamer` creates this overwrite vulnerability when the old promise finally resolves.\n\nThe solution is to remove the original assignment and rely solely on `onStreamer` to set it early—that way `destroy()` can abort the streamer immediately, and there's no stale promise overwriting it later.",
   "category": "bug",
   "severity": "high"
  },
  {
   "path": "packages/renderer-three/src/webgpu-render-manager.ts",
   "content": "**同 webgl-render-manager**: 与 WebGL 端相同的竞态问题。`onStreamer` 已设置 `this._sogStreamer = streamer`，`loadSogChunks` 返回后再次赋值会导致旧 streamer 覆盖新引用。建议删除此行。",
   "suggestion_code": "    // ★ onStreamer 回调已提前赋值; 此处不再赋值, 避免 abort 后迟到 resolve 覆盖新 streamer",
   "existing_code": "    this._sogStreamer = streamer;",
   "start_line": 731,
   "end_line": 731,
   "thinking": "Now I have a clear picture. The race condition exists in both render managers. Let me formulate my feedback.\n\nThe core issue is:\n\n1. `onStreamer` callback sets `this._sogStreamer = streamer` early (before `await streamer.start()`)\n2. The original `this._sogStreamer = streamer` still exists after `loadSogChunks` returns\n3. If the streamer is aborted (by a new `loadScene` or `destroy`) during `await streamer.start()`:\n   - `abort()` sets `aborted = true` and cancels fetch requests\n   - `start()` returns normally (doesn't throw for abort)\n   - `loadSogChunks` resolves with partial data\n   - The code after `loadSogChunks` runs, including `this._sogStreamer = streamer`\n   - This overwrites whatever new `_sogStreamer` was set by the new `loadScene`\n\nThe fix is to remove the redundant `this._sogStreamer = streamer` assignment after `loadSogChunks` since `onStreamer` already handles it. But there's a deeper issue: even with `onStreamer`, the stale `loadSogChunks` continues running after abort and eventually resolves, causing the same overwrite problem.\n\nActually, let me trace through the timeline more carefully. When `loadScene('B')` is called, it immediately aborts the old streamer and clears `_sogStreamer` before starting the new load, so by the time the stale `loadSogChunks` resolves, the new streamer is already in place. The real issue is that the old code's assignment after `loadSogChunks` was the only way `_sogStreamer` got set, so removing it without ensuring `onStreamer` fires reliably would leave it undefined. Looking at the execution flow, I can see the race condition clearly: when streamer A's chunks finish loading and resolve, it overwrites `_sogStreamer` with the stale streamer A, even though streamer B is now the active one. The problem is that both the `onStreamer` callback and the original assignment at line 880 execute, with the latter clobbering the former's reference.\n\nThe real issue is that the old code never set `_sogStreamer` until after `loadSogChunks` completed, so a `destroy()` call during the await would leave nothing to abort. But the new approach of setting it early via `onStreamer` creates this overwrite vulnerability when the old promise finally resolves.\n\nThe solution is to remove the original assignment and rely solely on `onStreamer` to set it early—that way `destroy()` can abort the streamer immediately, and there's no stale promise overwriting it later.",
   "category": "bug",
   "severity": "high"
  },
  {
   "path": "packages/core/src/scene-manager.ts",
   "content": "**Bug: `preloaded` 标记永远不会被重置**\n\n注释中已明确提到「渲染器缓存可能被 LRU 淘汰」，但代码中 `preloaded` 一旦被置为 `true`，在整个场景生命周期内**没有任何地方将其重置**。\n\n考虑以下时序：\n1. `preload('A')` 成功 → `meta.preloaded = true`\n2. `switchTo('A')` → 命中渲染器缓存，正常显示\n3. `switchTo('B')` → 渲染器 LRU 淘汰了 A 的缓存数据\n4. 再次 `preload('A')` → 因 `meta.preloaded === true` 直接 return，**跳过预加载**\n5. `switchTo('A')` → 渲染器缓存已失效，需重新下载 → preload 优化完全失效\n\n建议在 `loadScene` 或 `switchTo` 中清除已加载场景的 `preloaded` 标记，例如在 `switchTo` 成功后对**旧场景**重置：\n```ts\n// 在 switchTo 中, 切换成功后清除旧场景的 preloaded\nconst prevId = this.currentSceneId;\nif (prevId && prevId !== id) {\n  const prev = this.scenes.get(prevId);\n  if (prev) (prev as any).preloaded = false;\n}\n```\n或者在 `loadScene` 成功路径中清除 `preloaded`，使得下次 `preload` 能重新触发预取。",
   "existing_code": "        // ★ 预取成功: 置持久标记, 后续 preload 调用直接跳过 (同场景不会重复下载)\n        meta!.preloaded = true;",
   "start_line": 117,
   "end_line": 118,
   "thinking": "The `preloaded` flag is set to `true` on line 118 but is never cleared/reset anywhere in the codebase. The comment on line 105 acknowledges that \"渲染器缓存可能被 LRU 淘汰\" (renderer cache may be evicted by LRU), but there's no mechanism to reset the `preloaded` flag when that happens.\n\nThis is a real issue. Let me report it.\n\nLet me also verify the shader code once more. The L3 basis functions look correct. The indexing looks correct. The nesting structure is correct (L3 is inside L2 which is inside L1).\n\n\nNow I'm checking the `onStreamer` callback and the streamer assignment logic. The callback fires before `streamer.start()`, so if that throws an error, the caller already has a reference to the streamer through the callback—which is actually useful for cleanup. Looking at the render managers, both WebGL and WebGPU follow the same pattern where `this._sogStreamer` gets assigned from the returned streamer.\n\nThe confirmed issues already cover the redundant assignment and race condition there, so I'll move on.\n\nThe main issue I'm seeing is the `preloaded` flag never being reset in scene-manager.ts. I'm also noticing the nested ternary in scene-loader.ts that determines `shDim`—it checks if `shDegree` is defined, then either looks up a mapping or calculates dimensions from the existing data. The code forbids nested ternaries, but I need to verify if this actually qualifies as a nested ternary expression or just a chained conditional.\n\nLooking at the structure more carefully, this is actually a single ternary with a nested ternary only in the else branch, which is a common pattern for handling multiple conditions. It's not deeply nested, so I think it's acceptable here.\n\nSo my final assessment is that the only real issue to report is the `preloaded` flag not being reset.",
   "category": "bug",
   "severity": "medium"
  }
 ],
 "groups": [
  {
   "label": "Convert package: CLI, writers, and test fixtures",
   "files": [
    "packages/convert/src/cli.ts",
    "packages/convert/src/compressed-ply-writer.ts",
    "packages/convert/src/sog-writer.ts",
    "packages/convert/test-fixtures/benchmark-ply.ts"
   ]
  },
  {
   "label": "Scene management and rendering pipeline",
   "files": [
    "packages/core/src/scene-manager.ts",
    "packages/renderer-three/src/shared/scene-loader.ts",
    "packages/renderer-three/src/webgl-render-manager.ts",
    "packages/renderer-three/src/webgpu-render-manager.ts",
    "packages/renderer-three/src/wgsl/splat-render-shader.ts"
   ]
  }
 ],
 "resume": {
  "resumed_from": "9c755e28-2607-425a-96c9-1814cfbfd5ad",
  "reused_files": 1,
  "rerun_files": 9,
  "previous_model": "qwen3.7-plus",
  "current_model": "qwen3.7-plus"
 },
 "session_id": "67d28275-2da2-4e50-8b4f-b9b2fa44c9ae",
 "manifest": {
  "schema_version": "ocr.run-manifest/v1",
  "run_id": "67d28275-2da2-4e50-8b4f-b9b2fa44c9ae",
  "parent_run_id": "9c755e28-2607-425a-96c9-1814cfbfd5ad",
  "operation": "review",
  "terminal_state": "complete",
  "repository": {
   "identity_sha256": "24917b3473f877dec87e04d0be0efd51ce0f37e4ea88be32e3c745944b51f4aa"
  },
  "input": {
   "mode": "range",
   "requested_from": "2b0d1eb",
   "requested_head": "4a2bc51",
   "resolved_base": "2b0d1eb76222248f8a9f3ff1c7fb50914b0b0f49",
   "resolved_head": "4a2bc51b92eeb4df47fa14c153e6097ca57d5a43",
   "exact_range": "2b0d1eb76222248f8a9f3ff1c7fb50914b0b0f49..4a2bc51b92eeb4df47fa14c153e6097ca57d5a43",
   "source_artifact_sha256": "27d7180bbb6d6feda1683241332c0e88e781b5b57b3cda9154c6d7059c09d2c3"
  },
  "execution": {
   "ocr_version": "v1.12.0",
   "provider": "bifrost",
   "model": "qwen3.7-plus",
   "configured_concurrency": 8,
   "rule_config_sha256": "e85d22baeb3a9d3f35b254ea1df9f9644e5523ffdc5302939267695650e429c0",
   "runtime_config_sha256": "4149f77e6ed58ab88a6134a0af5ba91c264cf0148d05af750d91722ab1328641"
  },
  "coverage": {
   "selected": [
    {
     "item_id": "07b62fcac73bfa652f4d8354caca75d1c23a8e774253d5dd49ca73b0885d1450",
     "path": "packages/convert/src/sog-writer.ts",
     "fingerprint": "93c7ec1aba77fa14b2239e7df54ab38e0ee2a93a920d5d03230d714117278686"
    },
    {
     "item_id": "2c9b149f418a3d7f8cd7be3c4ba06df62fb07d7e75044f15190021174bd0b462",
     "path": "packages/renderer-three/src/wgsl/splat-render-shader.ts",
     "fingerprint": "7a0c7b0b153530671cff577032213ce3df049995bae1715bd9d57c3938429a8c"
    },
    {
     "item_id": "3af6575aa75947f710c41dfd77e7e971df0a3c3009ded76a3e8594aff37ad9ff",
     "path": "packages/convert/test-fixtures/benchmark-ply.ts",
     "fingerprint": "759b10182f409664cc4156bbcc782c51cb137ad5f48adb113a2fed5565e111cb"
    },
    {
     "item_id": "441f0f69b43f214f9d9182f238ec1f0174fe7a85b2d7968f849a655517a9ce09",
     "path": "apps/demo/src/main.ts",
     "fingerprint": "9a5089a9f0aea016de64ddc2c97efec9a8f916d0d071bac18278a55d9eaf96a4"
    },
    {
     "item_id": "62faa8997e70c3a7404856c5ee9bd52bf86d15e476ea49ebc8d64db0060684d2",
     "path": "packages/convert/src/compressed-ply-writer.ts",
     "fingerprint": "d9e248280d3c98b0d1da24a3025890b297c28000c7ffff96f591ac999aec8384"
    },
    {
     "item_id": "65d3a2e72993f947636e3c271b09f4dcaba2daac5b19608fe526820be2076d00",
     "path": "packages/convert/src/cli.ts",
     "fingerprint": "278be7aa050ea9e87ad1c543d656e968f6cb965b32f1c24e4716a9444ca1a2e0"
    },
    {
     "item_id": "7127c416be51cfe32ac5fde8fc55845cd36b9e92a676f729cc0558675e1c29f3",
     "path": "packages/core/src/scene-manager.ts",
     "fingerprint": "fed527448cbe3e1fb211472b869dcac33ee34c7822b235b0d19497b424a61009"
    },
    {
     "item_id": "73c2f89604cdc6a6c0d994af00c8a2bdb10c8709dccf7874533be3ce32308472",
     "path": "packages/renderer-three/src/webgl-render-manager.ts",
     "fingerprint": "62c7b1e2a786298730ba2270ba237435344ce0d9665dfb1b9ad445dab0a3b266"
    },
    {
     "item_id": "ea50a8cb2f9f0434ad0b3513dc00dd0c2291cb50e672001bcbf1cb101ae33788",
     "path": "packages/renderer-three/src/shared/scene-loader.ts",
     "fingerprint": "45f8b688eb410b6155d4d44138947ee080c6631f2a872b11a92d1f8dc64b2e29"
    },
    {
     "item_id": "eb902f87d2a2891eea5912c67bdb46dd5ca29c853c2e9150601d6204ad6b6762",
     "path": "packages/renderer-three/src/webgpu-render-manager.ts",
     "fingerprint": "13e7601b9e73eec137bd1bfef42d48fdbbb7aaf8f46c4fcdf88158feb26b55d2"
    }
   ],
   "completed": [
    {
     "item_id": "07b62fcac73bfa652f4d8354caca75d1c23a8e774253d5dd49ca73b0885d1450",
     "path": "packages/convert/src/sog-writer.ts",
     "fingerprint": "93c7ec1aba77fa14b2239e7df54ab38e0ee2a93a920d5d03230d714117278686"
    },
    {
     "item_id": "2c9b149f418a3d7f8cd7be3c4ba06df62fb07d7e75044f15190021174bd0b462",
     "path": "packages/renderer-three/src/wgsl/splat-render-shader.ts",
     "fingerprint": "7a0c7b0b153530671cff577032213ce3df049995bae1715bd9d57c3938429a8c"
    },
    {
     "item_id": "3af6575aa75947f710c41dfd77e7e971df0a3c3009ded76a3e8594aff37ad9ff",
     "path": "packages/convert/test-fixtures/benchmark-ply.ts",
     "fingerprint": "759b10182f409664cc4156bbcc782c51cb137ad5f48adb113a2fed5565e111cb"
    },
    {
     "item_id": "62faa8997e70c3a7404856c5ee9bd52bf86d15e476ea49ebc8d64db0060684d2",
     "path": "packages/convert/src/compressed-ply-writer.ts",
     "fingerprint": "d9e248280d3c98b0d1da24a3025890b297c28000c7ffff96f591ac999aec8384"
    },
    {
     "item_id": "65d3a2e72993f947636e3c271b09f4dcaba2daac5b19608fe526820be2076d00",
     "path": "packages/convert/src/cli.ts",
     "fingerprint": "278be7aa050ea9e87ad1c543d656e968f6cb965b32f1c24e4716a9444ca1a2e0"
    },
    {
     "item_id": "7127c416be51cfe32ac5fde8fc55845cd36b9e92a676f729cc0558675e1c29f3",
     "path": "packages/core/src/scene-manager.ts",
     "fingerprint": "fed527448cbe3e1fb211472b869dcac33ee34c7822b235b0d19497b424a61009"
    },
    {
     "item_id": "73c2f89604cdc6a6c0d994af00c8a2bdb10c8709dccf7874533be3ce32308472",
     "path": "packages/renderer-three/src/webgl-render-manager.ts",
     "fingerprint": "62c7b1e2a786298730ba2270ba237435344ce0d9665dfb1b9ad445dab0a3b266"
    },
    {
     "item_id": "ea50a8cb2f9f0434ad0b3513dc00dd0c2291cb50e672001bcbf1cb101ae33788",
     "path": "packages/renderer-three/src/shared/scene-loader.ts",
     "fingerprint": "45f8b688eb410b6155d4d44138947ee080c6631f2a872b11a92d1f8dc64b2e29"
    },
    {
     "item_id": "eb902f87d2a2891eea5912c67bdb46dd5ca29c853c2e9150601d6204ad6b6762",
     "path": "packages/renderer-three/src/webgpu-render-manager.ts",
     "fingerprint": "13e7601b9e73eec137bd1bfef42d48fdbbb7aaf8f46c4fcdf88158feb26b55d2"
    }
   ],
   "reused": [
    {
     "item_id": "441f0f69b43f214f9d9182f238ec1f0174fe7a85b2d7968f849a655517a9ce09",
     "path": "apps/demo/src/main.ts",
     "fingerprint": "9a5089a9f0aea016de64ddc2c97efec9a8f916d0d071bac18278a55d9eaf96a4"
    }
   ],
   "failed": [],
   "waived": []
  },
  "elapsed_ms": 410510
 },
 "retry_report": {
  "schema_version": "ocr.llm-retry-report/v1",
  "total_requests": 45,
  "retried_requests": 1,
  "total_retries": 4,
  "recovered_requests": 1,
  "failed_requests": 0,
  "cancelled_requests": 0,
  "requests": [
   {
    "logical_request_id": "eda0bbefcbdae66f7c909b85529ef52de08d76b4f3f14db875b39225b66afa7e",
    "provider": "bifrost",
    "model": "qwen3.7-plus",
    "file_path": "packages/convert/src/cli.ts,packages/convert/src/compressed-ply-writer.ts,packages/convert/src/sog-writer.ts,packages/convert/test-fixtures/benchmark-ply.ts",
    "task_type": "main_task",
    "request_no": 5,
    "outcome": "recovered",
    "attempts": [
     {
      "attempt": 1,
      "outcome": "error",
      "error_class": "rate_limited",
      "failure_phase": "http",
      "status_code": 429,
      "request_id": "4649f7db-9c71-4771-a308-c4e685403abd",
      "duration_to_headers_ms": 663
     },
     {
      "attempt": 2,
      "outcome": "error",
      "error_class": "rate_limited",
      "failure_phase": "http",
      "status_code": 429,
      "request_id": "2826eb9e-5bc8-4999-bbbe-4e832dbaca73",
      "observed_backoff_ms": 479,
      "duration_to_headers_ms": 662
     },
     {
      "attempt": 3,
      "outcome": "error",
      "error_class": "rate_limited",
      "failure_phase": "http",
      "status_code": 429,
      "request_id": "407ffa09-2f57-4dee-a8f1-958ee5f6581c",
      "observed_backoff_ms": 900,
      "duration_to_headers_ms": 702
     },
     {
      "attempt": 4,
      "outcome": "error",
      "error_class": "rate_limited",
      "failure_phase": "http",
      "status_code": 429,
      "request_id": "b1cbb2e9-c9f0-4af8-b87a-7bdf1368afb8",
      "observed_backoff_ms": 1581,
      "duration_to_headers_ms": 1169
     },
     {
      "attempt": 5,
      "outcome": "success",
      "status_code": 200,
      "request_id": "c4701ac2-fa20-4d8f-86a3-cdf0842152d0",
      "observed_backoff_ms": 3383,
      "duration_to_headers_ms": 3680
     }
    ]
   }
  ]
 },
 "_fix_notes": {
  "packages/renderer-three/src/webgl-render-manager.ts:0": "已修复 (2026-09-13): 删除 loadSogChunks await 后的重复 _sogStreamer 赋值 (onStreamer 已提前持有, 避免新场景 streamer 被旧加载覆盖的竞态)",
  "packages/renderer-three/src/webgpu-render-manager.ts:0": "已修复 (2026-09-13): 同上, 删除重复赋值消除竞态",
  "packages/core/src/scene-manager.ts:0": "已修复 (2026-09-13): 回退 preloaded 持久标记 — 渲染器 preloadScene 自带缓存去重 (_preloadCache.has), 持久标记无益且引入永不复位副作用",
  "apps/demo/src/main.ts:1114": "已修复 (2026-09-13): __getMediaPose 加 renderer null 守卫",
  "apps/demo/src/main.ts:1065": "已修复 (2026-09-13): 提取 total = sceneIds.length*formats.length 局部变量"
 }
}