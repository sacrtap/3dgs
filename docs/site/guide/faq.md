# 常见问题 (FAQ)

## 部署与 COOP/COEP

### Q: 为什么场景渲染帧率很低 (低于 10fps)?

**A**: 最常见的原因是服务器未配置 COOP/COEP 跨域隔离头。Spark 的 WASM Worker 排序依赖 `SharedArrayBuffer`，未配置时排序从 ~5ms 退化为 ~150ms。

**解决方案**:

在服务器响应头中添加:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: cross-origin
```

各平台配置方式参见 [部署指南](./deployment.md)。

### Q: GitHub Pages 不支持 COOP/COEP 怎么办?

**A**: GitHub Pages 无法自定义响应头。可以使用 Service Worker 代理方案 (Phase 5 规划中)，或将 Demo 部署到 Vercel / Cloudflare Pages 等支持自定义头的平台。

### Q: 加载 .ply / .spz / .splat 文件时出现 CORS 错误

**A**: 3DGS 数据文件通常较大，需要确保:
1. 数据文件服务器返回 `Cross-Origin-Resource-Policy: cross-origin` 头
2. 或使用同源服务器托管数据文件
3. CDN 需要配置正确的 CORS 头 (`Access-Control-Allow-Origin`)

---

## 渲染与性能

### Q: 桌面端帧率正常，但移动端很卡

**A**: 移动端 GPU 性能有限，建议:
1. 使用 `DeviceTier` 自动降级 (LOW 设备 0.5x 分辨率 + SH 0)
2. 使用 SOG 格式流式加载，避免一次性加载大场景
3. 使用 `@3dgs/convert` 工具降低 SH 阶数 (`--sh-degree 0`)
4. 启用 `AdaptiveResolution` 自适应分辨率

### Q: 场景加载后摄像机位置不对

**A**: RenderManager 会基于场景包围盒自动定位摄像机。如果场景坐标系异常:
1. 确认 `autoOrient` 选项 (默认 true，加载后垂直翻转 Y-down → Y-up)
2. 在 `tour.json` 中配置 `initialView` 指定初始视角
3. 使用 `scene-transition` 插件的 `fly` 过渡自动飞到指定视角

### Q: 如何调整移动速度?

**A**: 在 `RenderManagerOptions` 中配置:
```typescript
const renderer = new RenderManager({
  moveSpeed: 10.0,      // 默认 5.0
  verticalSpeed: 5.0,   // 默认 3.0
});
```

加载场景后，移动速度会根据场景大小自动调整 (每秒移动场景最大维度的 6%)。

### Q: FPS 显示为 0 或不变化

**A**: 检查是否正确挂载了帧回调:
1. `TourPlayer.load()` 必须在 `setRenderer()` 之后调用
2. 渲染器的 `start()` 由 TourPlayer 自动调用
3. 确保容器有明确的尺寸 (width/height 不为 0)

---

## 数据转换

### Q: PLY → SPZ 压缩比达不到 8×

**A**: 压缩比取决于 SH 阶数:
- SH 0: 约 3.85× (仅位置 + 颜色 + 缩放 + 旋转)
- SH 1-3: 可达 8×+ (SH 系数用 8-bit 量化压缩)

使用 `--sh-degree 1` 或更高阶数以获得更好压缩比。

### Q: 转换后的场景颜色异常

**A**: 检查 PLY 文件的 SH 阶数是否与转换命令匹配:
```bash
# 检查 PLY 文件信息
npx @3dgs/convert info input.ply

# 指定正确的 SH 阶数
npx @3dgs/convert ply-to-spz input.ply --output output.spz --sh-degree 3
```

### Q: 批量转换时某些文件失败

**A**: 使用 `batch` 命令会跳过失败文件并继续处理:
```bash
npx @3dgs/convert batch ./scenes/ --format spz --sh-degree 1
```

输出会显示成功/失败计数，失败的文件通常是 PLY 格式不规范。

---

## 插件与框架

### Q: 热点不显示或位置不对

**A**: 常见原因:
1. 确认热点插件已注册: `player.use(createHotspotSystem())`
2. 确认场景配置中 `extensions.hotspot.hotspots` 数组不为空
3. 热点 3D 坐标使用场景坐标系 (Y-up)
4. 如果热点被场景遮挡，检查 `depth-occlusion` 插件配置

### Q: React 组件每次渲染都重建 TourPlayer

**A**: 确保 `renderer` 和 `plugins` props 使用稳定引用:
```tsx
// ✅ 正确: 使用 useMemo 稳定引用
const renderer = useMemo(() => new RenderManager(), []);
const plugins = useMemo(() => [createHotspotSystem()], []);

<TourViewer config={config} renderer={renderer} plugins={plugins} />

// ❌ 错误: 每次渲染创建新实例
<TourViewer config={config} renderer={new RenderManager()} />
```

回调函数 (onLoad, onError 等) 使用 useRef 包裹，不会触发重建。

### Q: 自定义 Shader 注入不生效

**A**: 检查:
1. Shader 注入代码是有效的 GLSL
2. `ShaderHookPoint` 选择了正确的注入位置
3. uniform 名称不与 Spark 内置 uniform 冲突
4. 使用 `ShaderInjectionPlugin` 封装而非直接调用 `renderer.addShaderInjection()`

---

## 构建与发布

### Q: npm 安装后 TypeScript 类型报错

**A**: 确保 `tsconfig.json` 的 `moduleResolution` 设置为 `bundler` 或 `node16`:
```json
{
  "compilerOptions": {
    "moduleResolution": "bundler"
  }
}
```

### Q: 构建产物体积过大

**A**: 确认:
1. `three` 和 `@sparkjsdev/spark` 在 `peerDependencies` 中 (不重复打包)
2. 包的 `sideEffects` 设置为 `false`
3. 使用 Vite/Rollup 的 tree-shaking

### Q: 如何在项目中使用本地开发版本?

**A**: 使用 pnpm link 或 workspace 协议:
```bash
# 在 3dgs 项目中
pnpm build

# 在你的项目中
pnpm link /path/to/3dgs/packages/core
pnpm link /path/to/3dgs/packages/renderer-three
```
