# Shader 效果

使用 Shader 注入 API 实现自定义渲染效果。

## 冷/暖色调

```typescript
import { ShaderHookPoint } from '@3dgs/core';

// 冷色调
renderer.addShaderInjection({
  id: 'color-cool',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  code: 'gl_FragColor.rgb = vec3(gl_FragColor.r * 0.8, gl_FragColor.g * 0.9, gl_FragColor.b * 1.2);',
});

// 暖色调
renderer.addShaderInjection({
  id: 'color-warm',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  code: 'gl_FragColor.rgb = vec3(gl_FragColor.r * 1.2, gl_FragColor.g * 1.0, gl_FragColor.b * 0.7);',
});
```

## 灰度模式

```typescript
renderer.addShaderInjection({
  id: 'grayscale',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  code: 'float gray = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)); gl_FragColor.rgb = vec3(gray);',
});
```

## 时间动画 (Uniform)

```typescript
renderer.addShaderInjection({
  id: 'pulse',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  uniforms: { uTime: 0.0 },
  code: 'gl_FragColor.rgb *= 0.75 + 0.25 * sin(uTime * 2.0);',
  onUpdate: (uniforms, deltaTime) => {
    uniforms.uTime.value += deltaTime / 1000;
  },
});
```

## 暗角效果

```typescript
renderer.addShaderInjection({
  id: 'vignette',
  hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
  uniforms: { uIntensity: 0.5 },
  code: 'vec2 uv = gl_FragCoord.xy / vec2(1920.0, 1080.0); float dist = distance(uv, vec2(0.5)); gl_FragColor.rgb *= 1.0 - dist * uIntensity;',
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
    code: 'gl_FragColor.rgb *= 0.75 + 0.25 * sin(uTime * 2.0);',
    onUpdate: (u, dt) => { u.uTime.value += dt / 1000; },
  }],
}));
```

## 移除效果

```typescript
renderer.removeShaderInjection('pulse');
```
