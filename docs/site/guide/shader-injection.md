# Shader 注入

3DGS 引擎提供自定义 GLSL Shader 注入 API，允许在不修改 Spark 核心代码的前提下向渲染管线注入自定义代码。

## 注入点

| 注入点 | 说明 |
|--------|------|
| `VERTEX_MAIN_BEGIN` | 顶点着色器 main() 开头 |
| `VERTEX_BEFORE_POSITION` | gl_Position 赋值前 |
| `VERTEX_MAIN_END` | 顶点着色器 main() 结尾 |
| `FRAGMENT_MAIN_BEGIN` | 片段着色器 main() 开头 |
| `FRAGMENT_BEFORE_OUTPUT` | gl_FragColor 赋值前 |
| `FRAGMENT_MAIN_END` | 片段着色器 main() 结尾 |

## 使用方式

### 直接通过渲染器 API

```typescript
import { ShaderHookPoint } from '@3dgs/core';

renderer.addShaderInjection({
  id: 'color-shift',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  code: 'gl_FragColor.rgb = vec3(gl_FragColor.r * 1.2, gl_FragColor.g, gl_FragColor.b * 0.8);',
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
    code: 'gl_FragColor.rgb *= 0.75 + 0.25 * sin(uTime * 2.0);',
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

## 内置效果示例

Demo 应用中内置了 5 个 Shader 效果：

| 效果 | 说明 |
|------|------|
| 冷色调 | RGB 通道偏移 |
| 暖色调 | RGB 通道偏移 |
| 灰度模式 | 亮度计算 |
| 脉冲动画 | 基于 uTime 的亮度动画 |
| 暗角效果 | 基于像素距离的边缘暗化 |
