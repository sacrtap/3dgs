# Shader 注入

3DGS 引擎提供自定义 GLSL Shader 注入 API，允许在不修改 Spark 核心代码的前提下向渲染管线注入自定义代码。

## 注入点

| 注入点 | 说明 |
|--------|------|
| `VERTEX_MAIN_BEGIN` | 顶点着色器 main() 开头 |
| `VERTEX_BEFORE_POSITION` | gl_Position 赋值前 |
| `VERTEX_MAIN_END` | 顶点着色器 main() 结尾 |
| `FRAGMENT_MAIN_BEGIN` | 片段着色器 main() 开头 |
| `FRAGMENT_BEFORE_OUTPUT` | fragColor 赋值后 (main 末尾) |
| `FRAGMENT_MAIN_END` | 片段着色器 main() 结尾 |

## 使用方式

### 直接通过渲染器 API

```typescript
import { ShaderHookPoint } from '@3dgs/core';

renderer.addShaderInjection({
  id: 'color-shift',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  code: 'fragColor.rgb = vec3(fragColor.r * 1.2, fragColor.g, fragColor.b * 0.8);',
});

// 移除
renderer.removeShaderInjection('color-shift');
```

### 通过插件系统

```typescript
import { ShaderHookPoint } from '@3dgs/core';
import { createShaderInjectionPlugin } from '@3dgs/plugins';

player.use(createShaderInjectionPlugin({
  injections: [{
    id: 'pulse',
    hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
    uniforms: { uTime: 0.0 },
    code: 'fragColor.rgb *= 0.75 + 0.25 * sin(uTime * 2.0);',
    onUpdate: (u, dt) => { u.uTime.value += dt / 1000; },
  }],
}));
```

## Uniform 类型推断

Uniform 值会根据 JS 类型自动推断 GLSL 类型：

| JS 类型 | GLSL 类型 |
|---------|----------|
| `number` | `float` |
| `THREE.Vector2` / `[n, n]` | `vec2` |
| `THREE.Vector3` / `[n, n, n]` | `vec3` |
| `THREE.Vector4` / `[n, n, n, n]` | `vec4` |
| `THREE.Matrix3` | `mat3` |
| `THREE.Matrix4` | `mat4` |
| `THREE.Color` | `vec3` |

## 动态增删与多注入叠加

Shader 注入支持运行时动态增删，多个注入可以同时叠加生效：

- **添加注入** — `addShaderInjection()` 立即将 GLSL 代码应用到当前材质
- **移除注入** — `removeShaderInjection(id)` 移除指定注入，剩余注入保持生效
- **全部移除** — 当最后一个注入被移除后，Shader 自动恢复为原始源码

每次增删操作都会从保存的原始 Shader 源码重新构建，确保多注入叠加和频繁切换时的状态一致性。

> **注意**: 如果注入包含 `uniforms` 且需要动态更新（如时间动画、视口尺寸同步），请提供 `onUpdate` 回调。回调每帧执行一次，通过修改 `uniforms[key].value` 来更新 GPU 端的值。

## 内置效果示例

Demo 应用中内置了 5 个 Shader 效果，可通过 UI 面板动态切换：

| 效果 | 说明 |
|------|------|
| 冷色调 | RGB 通道偏移 (R×0.8, G×0.9, B×1.2) |
| 暖色调 | RGB 通道偏移 (R×1.2, G×1.0, B×0.7) |
| 灰度模式 | 基于亮度的灰度转换 |
| 脉冲动画 | 基于 uTime 的正弦亮度动画 |
| 暗角效果 | 基于 uResolution 的边缘暗化 (动态适配视口) |
