# Shader 效果

使用 Shader 注入 API 实现自定义渲染效果。

## 冷/暖色调

```typescript
import { ShaderHookPoint } from '@3dgs/core';

// 冷色调
renderer.addShaderInjection({
  id: 'color-cool',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  code: 'fragColor.rgb = vec3(fragColor.r * 0.8, fragColor.g * 0.9, fragColor.b * 1.2);',
});

// 暖色调
renderer.addShaderInjection({
  id: 'color-warm',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  code: 'fragColor.rgb = vec3(fragColor.r * 1.2, fragColor.g * 1.0, fragColor.b * 0.7);',
});
```

## 灰度模式

```typescript
renderer.addShaderInjection({
  id: 'grayscale',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  code: 'float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114)); fragColor.rgb = vec3(gray);',
});
```

## 时间动画 (Uniform)

```typescript
renderer.addShaderInjection({
  id: 'pulse',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  uniforms: { uTime: 0.0 },
  code: 'fragColor.rgb *= 0.75 + 0.25 * sin(uTime * 2.0);',
  onUpdate: (uniforms, deltaTime) => {
    uniforms.uTime.value += deltaTime / 1000;
  },
});
```

## 暗角效果

使用动态 `uResolution` uniform 替代硬编码分辨率，确保不同屏幕尺寸下效果一致：

```typescript
renderer.addShaderInjection({
  id: 'vignette',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  uniforms: {
    uIntensity: 0.5,
    uResolution: [1920.0, 1080.0],  // 初始值, 会被 onUpdate 覆盖
  },
  code: 'vec2 uv = gl_FragCoord.xy / uResolution; float dist = distance(uv, vec2(0.5)); fragColor.rgb *= 1.0 - dist * uIntensity;',
  onUpdate: (uniforms) => {
    const size = renderer.getSize();
    uniforms.uResolution.value = [size.width, size.height];
  },
});
```

## 通过插件使用

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

## 动态切换效果

Shader 注入支持运行时动态增删，可以同时叠加多个效果：

```typescript
// 添加冷色调
renderer.addShaderInjection({
  id: 'color-cool',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  code: 'fragColor.rgb = vec3(fragColor.r * 0.8, fragColor.g * 0.9, fragColor.b * 1.2);',
});

// 叠加暗角效果
renderer.addShaderInjection({
  id: 'vignette',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  uniforms: { uIntensity: 0.5, uResolution: [1920.0, 1080.0] },
  code: 'vec2 uv = gl_FragCoord.xy / uResolution; float dist = distance(uv, vec2(0.5)); fragColor.rgb *= 1.0 - dist * uIntensity;',
  onUpdate: (u) => { const s = renderer.getSize(); u.uResolution.value = [s.width, s.height]; },
});

// 移除单个效果 (其余注入保持不变)
renderer.removeShaderInjection('color-cool');

// 移除所有效果后, Shader 自动恢复为原始源码
renderer.removeShaderInjection('vignette');
```

> **注意**: 每次增删注入时，渲染器会从原始 Shader 源码重新构建，确保多注入叠加和动态切换的状态一致性。
