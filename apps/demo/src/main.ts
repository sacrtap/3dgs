import { TourPlayer, ShaderHookPoint } from '@3dgs/core';
import { createRenderer, RenderManager } from '@3dgs/renderer-three';
import { createHotspotSystem, createMediaEmbed, createPreset } from '@3dgs/plugins';
import { extractCameraPose } from '@3dgs/plugins/media-embed';

async function main() {
  const container = document.getElementById('viewer');
  const loading = document.getElementById('loading');
  const loadingText = document.getElementById('loading-text');
  const errorEl = document.getElementById('error');
  const hudEl = document.getElementById('hud');
  const selectorEl = document.getElementById('scene-selector');

  // ── 创建播放器 ──
  const player = new TourPlayer(container);

  // ── 插件: 热点系统 (含点击弹出) + 空间媒体嵌入 (图像/视频) ──
  const hotspotSys = createHotspotSystem();
  const mediaEmbed = createMediaEmbed();
  player.use(hotspotSys);
  player.use(mediaEmbed);

  // ── 渲染后端管理 ──
  let renderer = null;
  let backend = 'webgl2';
  let webgpuCapability = null;
  let frameUnsub = null;  // demo 自身的 onFrame 订阅
  let currentBackendMode = 'webgl2'; // 'auto' | 'webgl2' | 'webgpu'

  /**
   * 创建并初始化渲染器
   * @param {'auto'|'webgl2'|'webgpu'} mode
   */
  async function createAndInitRenderer(mode) {
    const opts = mode === 'auto'
      ? { preferredBackend: 'webgpu' }       // auto: 偏好 WebGPU, 不可用则回退
      : mode === 'webgl2'
        ? { preferredBackend: 'webgl2' }      // 强制 WebGL
        : { preferredBackend: 'webgpu', forceBackend: true }; // 强制 WebGPU

    const result = await createRenderer(opts);

    // WebGPU 后端需要手动 init()
    if (result.backend === 'webgpu') {
      await result.renderer.init();
    }

    return result;
  }

  // ── 创建渲染器 (默认 WebGL2 以获得最佳性能) ──
  loadingText.textContent = '初始化渲染器...';
  const _initResult = await createAndInitRenderer('webgl2');
  renderer = _initResult.renderer;
  backend = _initResult.backend;
  webgpuCapability = _initResult.webgpuCapability;
  currentBackendMode = 'webgl2';

  player.setRenderer(renderer);

  // ── 场景数据配置 (5 场景 × 4 格式) ──
  const sceneData = {
    kitchen: {
      title: 'Kitchen',
      splatCount: '248K',
      formats: {
        ply:  { url: null, size: '—', desc: '无 PLY 源文件' },
        splat:{ url: '/kitchen.splat', size: '7.6 MB', desc: '.splat (32B/splat)' },
        spz:  { url: '/kitchen.spz', size: '3.7 MB', desc: 'SPZ (gzip 压缩)' },
        sog:  { url: '/kitchen.sog', size: '7.2 MB', desc: 'SOG 流式 LOD' },
      },
    },
    demo1: {
      title: 'Demo1',
      splatCount: '991K',
      formats: {
        ply:  { url: '/demo1.ply', size: '15.4 MB', desc: 'PLY 原始格式' },
        splat:{ url: '/demo1.splat', size: '30.3 MB', desc: '.splat (32B/splat)' },
        spz:  { url: '/demo1.spz', size: '14.4 MB', desc: 'SPZ (gzip 压缩)' },
        sog:  { url: '/demo1.sog', size: '29.0 MB', desc: 'SOG 流式 LOD' },
      },
    },
    storysplat: {
      title: 'StorySplat',
      splatCount: '1.3M',
      formats: {
        ply:  { url: null, size: '—', desc: '无 PLY 源文件' },
        splat:{ url: '/storysplat.splat', size: '39.7 MB', desc: '.splat (32B/splat)' },
        spz:  { url: '/storysplat.spz', size: '19.8 MB', desc: 'SPZ (gzip 压缩)' },
        sog:  { url: '/storysplat.sog', size: '37.4 MB', desc: 'SOG 流式 LOD' },
      },
    },
    demo2: {
      title: 'Demo2',
      splatCount: '3.97M',
      formats: {
        ply:  { url: '/demo2.ply', size: '61.7 MB', desc: 'PLY 原始格式' },
        splat:{ url: '/demo2.splat', size: '121.3 MB', desc: '.splat (32B/splat)' },
        spz:  { url: '/demo2.spz', size: '56.3 MB', desc: 'SPZ (gzip 压缩)' },
        sog:  { url: '/demo2.sog', size: '116.9 MB', desc: 'SOG 流式 LOD' },
      },
    },
    garden: {
      title: 'Garden',
      splatCount: '5.83M',
      formats: {
        ply:  { url: '/garden.ply', size: '90.6 MB', desc: 'PLY 原始格式' },
        splat:{ url: '/garden.splat', size: '178.1 MB', desc: '.splat (32B/splat)' },
        spz:  { url: '/garden.spz', size: '79.8 MB', desc: 'SPZ (gzip 压缩)' },
        sog:  { url: '/garden.sog', size: '168.4 MB', desc: 'SOG 流式 LOD' },
      },
    },
  };

  let currentSceneId = 'kitchen';
  let currentFormat = 'splat';
  let isSwitching = false;

  // ── 漫游配置 ──
  const config = {
    version: '1.0',
    meta: { title: '3DGS 性能基准', description: '5 场景 × 4 格式性能测试' },
    defaults: {
      camera: { fov: 60, minFov: 30, maxFov: 90, limitPitch: [-80, 80] },
      transition: { type: 'fade', duration: 400 },
    },
    scenes: {},
  };

  // 动态生成场景配置
  for (const [id, data] of Object.entries(sceneData)) {
    config.scenes[id] = {
      title: data.title,
      source: data.formats.splat.url,
      initialView: { yaw: 0, pitch: 0, fov: 60 },
    };
  }

  // ── 性能基准测试系统 ──
  const bench = {
    active: false,
    loadStartTime: 0,
    loadTime: 0,
    frameTimes: [],
    fpsHistory: [],
    lastFrameTime: 0,
    collecting: false,
    collectDuration: 10000, // 10s 采样
    results: [], // { scene, format, loadTime, fpsAvg, fpsP50, fpsP5, frameTimeP95, frameTimeMax, splatCount }
  };

  // ★ L2: RAF 合并过滤阈值 — 低于此值的帧时间为 RAF 合并伪影
  //   浏览器在 tab 不可见或 RAF 回调合并时产生 1-3ms 的假帧
  //   这些假帧的 FPS = 1000/3 ≈ 333, 严重拉高 Avg
  //   过滤后 Avg FPS 更接近真实感知帧率
  const RAF_MERGE_THRESHOLD_MS = 3;

  function startBenchCollection() {
    bench.collecting = true;
    bench.frameTimes = [];
    bench.fpsHistory = [];
    bench.lastFrameTime = performance.now();
  }

  function stopBenchCollection() {
    bench.collecting = false;
  }

  function recordFrame() {
    if (!bench.collecting) return;
    const now = performance.now();
    const dt = now - bench.lastFrameTime;
    bench.lastFrameTime = now;
    // ★ L2: 过滤 RAF 合并伪影 (dt < 3ms)
    if (dt >= RAF_MERGE_THRESHOLD_MS) {
      bench.frameTimes.push(dt);
      bench.fpsHistory.push(1000 / dt);
    }
  }

  function computeStats() {
    const fts = bench.frameTimes;
    const fps = bench.fpsHistory;
    if (fts.length === 0) return null;

    fts.sort((a, b) => a - b);
    fps.sort((a, b) => a - b);

    // ★ L2: 修复 ftStd 计算 — 使用帧时间均值而非 FPS 均值
    const ftMean = fts.reduce((a, b) => a + b, 0) / fts.length;
    const ftStd = Math.sqrt(fts.reduce((a, b) => a + (b - ftMean) ** 2, 0) / fts.length);

    // ★ L2: fpsAvg 仅作参考, P50/P5 为主要指标
    const fpsAvg = fps.reduce((a, b) => a + b, 0) / fps.length;
    const fpsP50 = fps[Math.floor(fps.length * 0.5)];
    const fpsP5 = fps[Math.floor(fps.length * 0.05)];
    const ftP95 = fts[Math.floor(fts.length * 0.95)];
    const ftMax = fts[fts.length - 1];
    const droppedFrames = fts.filter(t => t > 20).length;
    const dropRate = (droppedFrames / fts.length * 100);

    return { fpsAvg, fpsP50, fpsP5, ftP95, ftMax, ftStd, dropRate, sampleCount: fts.length };
  }

  function formatNum(n, decimals = 1) {
    return (typeof n === 'number' && isFinite(n)) ? n.toFixed(decimals) : '—';
  }

  function updateBenchStats() {
    const statsEl = document.getElementById('bench-stats');
    if (!statsEl) return;

    if (bench.frameTimes.length === 0) {
      statsEl.innerHTML = '<div class="stat-row"><span class="stat-label">等待数据...</span></div>';
      return;
    }

    const stats = computeStats();
    if (!stats) return;

    statsEl.innerHTML = [
      `<div class="stat-row"><span class="stat-label">场景</span><span class="stat-value">${sceneData[currentSceneId]?.title || '—'}</span></div>`,
      `<div class="stat-row"><span class="stat-label">格式</span><span class="stat-value">${currentFormat.toUpperCase()}</span></div>`,
      `<div class="stat-row"><span class="stat-label">加载时间</span><span class="stat-value">${formatNum(bench.loadTime, 0)} ms</span></div>`,
      `<div class="stat-row"><span class="stat-label">FPS (Avg)</span><span class="stat-value">${formatNum(stats.fpsAvg)}</span></div>`,
      `<div class="stat-row"><span class="stat-label">FPS (P50)</span><span class="stat-value">${formatNum(stats.fpsP50)}</span></div>`,
      `<div class="stat-row"><span class="stat-label">FPS (P5)</span><span class="stat-value">${formatNum(stats.fpsP5)}</span></div>`,
      `<div class="stat-row"><span class="stat-label">帧时间 P95</span><span class="stat-value">${formatNum(stats.ftP95)} ms</span></div>`,
      `<div class="stat-row"><span class="stat-label">帧时间 Max</span><span class="stat-value">${formatNum(stats.ftMax)} ms</span></div>`,
      `<div class="stat-row"><span class="stat-label">丢帧率</span><span class="stat-value">${formatNum(stats.dropRate)}%</span></div>`,
      `<div class="stat-row"><span class="stat-label">采样数</span><span class="stat-value">${stats.sampleCount}</span></div>`,
    ].join('');
  }

  function renderBenchReport() {
    const reportEl = document.getElementById('bench-report');
    if (!reportEl) return;
    if (bench.results.length === 0) {
      reportEl.innerHTML = '<div style="color:rgba(255,255,255,0.3);text-align:center;padding:8px;">暂无测试结果</div>';
      return;
    }

    let html = '<table><tr><th>场景</th><th>格式</th><th>加载</th><th>FPS</th><th>P95</th></tr>';
    for (const r of bench.results) {
      html += `<tr><td>${r.scene}</td><td>${r.format}</td><td>${formatNum(r.loadTime, 0)}ms</td><td>${formatNum(r.fpsP50)}</td><td>${formatNum(r.frameTimeP95)}ms</td></tr>`;
    }
    html += '</table>';
    reportEl.innerHTML = html;
  }

  function exportBenchReport() {
    if (bench.results.length === 0) {
      showInfo('暂无测试结果可导出');
      return;
    }

    // 生成 Markdown 报告
    let md = '# 3DGS 性能基准测试报告\n\n';
    md += `**测试时间**: ${new Date().toISOString()}\n`;
    md += `**后端**: ${backend.toUpperCase()}\n`;
    md += `**设备分级**: ${['LOW','MEDIUM','HIGH','ULTRA'][renderer.getDeviceTier()]}\n`;
    const gpuInfo = webgpuCapability?.adapterInfo
      ? `${webgpuCapability.adapterInfo.vendor} ${webgpuCapability.adapterInfo.architecture}` : 'N/A';
    md += `**GPU**: ${gpuInfo}\n`;
    md += `**SAB**: ${RenderManager.isCrossOriginIsolated() ? '✓' : '✗'}\n\n`;

    md += '## 测试结果汇总\n\n';
    md += '| 场景 | 格式 | Splat 数 | 加载时间 (ms) | FPS Avg | FPS P50 | FPS P5 | 帧时间 P95 (ms) | 帧时间 Max (ms) | 丢帧率 (%) |\n';
    md += '|------|------|---------|-------------|---------|---------|--------|---------------|---------------|----------|\n';
    for (const r of bench.results) {
      md += `| ${r.scene} | ${r.format} | ${r.splatCount} | ${formatNum(r.loadTime, 0)} | ${formatNum(r.fpsAvg)} | ${formatNum(r.fpsP50)} | ${formatNum(r.fpsP5)} | ${formatNum(r.frameTimeP95)} | ${formatNum(r.frameTimeMax)} | ${formatNum(r.dropRate)} |\n`;
    }

    // 下载为文件
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `benchmark-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showInfo(`已导出 ${bench.results.length} 条测试结果`);
  }

  // ── HUD: 设备信息 + FPS ──
  let tier = renderer.getDeviceTier();
  const tierNames = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];
  let fps = 0;
  let frameCount = 0;
  let fpsTimer = performance.now();

  // ── Shader 效果定义 ──
  const shaderEffects = {
    'color-cool': {
      id: 'color-cool',
      hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
      code: 'fragColor.rgb = vec3(fragColor.r * 0.8, fragColor.g * 0.9, fragColor.b * 1.2);'
    },
    'color-warm': {
      id: 'color-warm',
      hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
      code: 'fragColor.rgb = vec3(fragColor.r * 1.2, fragColor.g * 1.0, fragColor.b * 0.7);'
    },
    'grayscale': {
      id: 'grayscale',
      hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
      code: 'float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114)); fragColor.rgb = vec3(gray);'
    },
    'pulse': {
      id: 'pulse',
      hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
      uniforms: { uTime: 0.0 },
      code: 'fragColor.rgb *= 0.75 + 0.25 * sin(uTime * 2.0);',
      onUpdate: (u, dt) => { u.uTime.value += dt / 1000; },
    },
    'vignette': {
      id: 'vignette',
      hook: ShaderHookPoint.FRAGMENT_BEFORE_OUTPUT,
      uniforms: { uIntensity: 0.5, uResolution: [1920.0, 1080.0] },
      code: 'vec2 uv = gl_FragCoord.xy / uResolution; float dist = distance(uv, vec2(0.5)); fragColor.rgb *= 1.0 - dist * uIntensity;',
      onUpdate: (u) => {
        const size = renderer.getSize();
        u.uResolution.value = [size.width, size.height];
      },
    },
    // ★ 预设效果库 (@3dgs/plugins createPreset): 复古/反色/扫描线
    'sepia': createPreset('sepia', { intensity: 0.85 }),
    'invert': createPreset('invert', { intensity: 0.9 }),
    'scanline': createPreset('scanline', { intensity: 0.6 }),
  };
  const activeShaderEffects = new Set();

  // ── ★ 空间扩展: 热点(弹出)/图像/视频嵌入按钮 ──
  let embedSeq = 0;

  /** 相机前方 depth 米处的世界坐标 (用于动态放置热点/媒体) */
  function cameraForwardPoint(depth) {
    const pose = extractCameraPose(renderer.getViewProjectionMatrix());
    if (!pose) return [0, 0, 0];
    return [
      pose.center[0] - pose.zAxis[0] * depth,
      pose.center[1] - pose.zAxis[1] * depth,
      pose.center[2] - pose.zAxis[2] * depth,
    ];
  }

  document.getElementById('btn-add-hotspot').onclick = () => {
    const id = 'dyn-hs-' + (++embedSeq);
    hotspotSys.addHotspot({
      id,
      type: 'scene',
      position: cameraForwardPoint(2.5),
      style: { color: '#7cc4ff', glow: true, pulse: true, size: 36 },
      popup: {
        title: `动态热点 #${embedSeq}`,
        content: '这是运行时添加的热点, 点击后弹出此面板。<br/><b>popup</b> 配置支持 标题 / HTML 内容 / 内嵌图片。',
        imageUrl: '/demo-photo.png',
        width: 300,
      },
    });
    showInfo(`已添加热点 ${id} (相机前方 2.5m), 点击热点试试弹出面板`);
  };

  document.getElementById('btn-add-scene-hotspot').onclick = () => {
    // 选择一个不同于当前的目标场景 (循环取下一个)
    const sceneIds = Object.keys(config.scenes);
    const idx = sceneIds.indexOf(currentSceneId);
    const targetId = sceneIds[(idx + 1) % sceneIds.length];
    const targetTitle = config.scenes[targetId]?.title || targetId;

    const id = 'dyn-scene-hs-' + (++embedSeq);
    hotspotSys.addHotspot({
      id,
      type: 'scene',
      position: cameraForwardPoint(2.5),
      targetScene: targetId,
      transition: { type: 'fade', duration: 600 },
      style: { color: '#ffd27c', glow: true, pulse: true, size: 40 },
      onHover: { tooltip: `前往 ${targetTitle}` },
    });
    showInfo(`已添加场景切换热点 ${id} → ${targetTitle}, 点击热点切换场景`);
  };

  document.getElementById('btn-embed-image').onclick = () => {
    const id = 'dyn-img-' + (++embedSeq);
    mediaEmbed.add({
      id,
      type: 'image',
      url: '/demo-photo.png',
      position: cameraForwardPoint(3),
      width: 2.4, height: 1.35,
      feather: 0.1,
      depthBlur: { start: 4, range: 8, max: 3 },
    });
    showInfo(`已嵌入图像 ${id} (相机前方 3m, 羽化+深度模糊融合)`);
  };

  document.getElementById('btn-embed-video').onclick = () => {
    const id = 'dyn-video-' + (++embedSeq);
    mediaEmbed.add({
      id,
      type: 'video',
      url: '/demo-video.webm',
      position: cameraForwardPoint(3),
      width: 2.0, height: 1.125,
      autoplay: true, loop: true, muted: true,
      feather: 0.08,
      nearFade: 0.8,
    });
    showInfo(`已嵌入视频 ${id} (自动循环播放, 点击视频可暂停/继续)`);
  };

  document.getElementById('btn-clear-embeds').onclick = () => {
    for (const cfg of mediaEmbed.list()) mediaEmbed.remove(cfg.id);
    showInfo('已清除全部嵌入媒体');
  };

  player.on('media:ready', (d) => { console.log('[demo] media ready:', d.id); });
  player.on('media:error', (d) => { showInfo(`媒体加载失败: ${d.url}`); });
  player.on('hotspot:popup-open', (d) => { console.log('[demo] popup open:', d.id); });

  function toggleShaderEffect(effectId, enabled) {
    const effect = shaderEffects[effectId];
    if (!effect) return;
    if (enabled) {
      if (activeShaderEffects.has(effectId)) return;
      activeShaderEffects.add(effectId);
      renderer.addShaderInjection({ ...effect });
    } else {
      if (!activeShaderEffects.has(effectId)) return;
      activeShaderEffects.delete(effectId);
      renderer.removeShaderInjection(effectId);
    }
  }

  player.on('load', () => {
    loading.style.display = 'none';
    hudEl.style.display = 'block';
    showInfo('拖拽旋转 / 滚轮前进 / 点击场景按钮切换 / 点击格式切换数据');

    // 显示格式面板
    const formatPanel = document.getElementById('format-panel');
    const formatToggles = document.getElementById('format-toggles');
    if (formatPanel && formatToggles) {
      formatPanel.style.display = 'block';
      formatToggles.innerHTML = '';
      const formatLabels = {
        ply: '📄 PLY',
        splat: '📦 Splat',
        spz: '🗜️ SPZ',
        sog: '🌊 SOG',
      };
      for (const [fmt, label] of Object.entries(formatLabels)) {
        const scene = sceneData[currentSceneId];
        const fmtData = scene.formats[fmt];
        const isDisabled = !fmtData.url;
        const row = document.createElement('div');
        row.className = 'format-toggle-row' + (fmt === currentFormat ? ' active' : '') + (isDisabled ? ' disabled' : '');
        row.innerHTML = `<span class="format-label">${label}<br><span class="format-size">${fmtData.size}</span></span><span class="format-toggle-switch"></span>`;
        if (!isDisabled) {
          row.onclick = async () => {
            if (isSwitching || fmt === currentFormat) return;
            row.classList.add('active');
            document.querySelectorAll('.format-toggle-row').forEach(r => {
              if (r !== row) r.classList.remove('active');
            });
            await switchFormat(fmt);
          };
        }
        formatToggles.appendChild(row);
      }
    }

    // 显示 Shader 面板
    const shaderPanel = document.getElementById('shader-panel');
    const shaderToggles = document.getElementById('shader-toggles');
    const shaderClearBtn = document.getElementById('shader-clear-btn');
    if (shaderPanel && shaderToggles) {
      shaderPanel.style.display = 'block';
      const effectLabels = {
        'color-cool': '❄️ 冷色调',
        'color-warm': '🔥 暖色调',
        'grayscale': '⚫ 灰度模式',
        'pulse': '✨ 脉冲动画',
        'vignette': '🔍 暗角效果',
        'sepia': '🟤 复古色调',
        'invert': '🔄 颜色反转',
        'scanline': '📺 扫描线',
      };
      const shaderToggleRows = {};
      for (const [id, label] of Object.entries(effectLabels)) {
        const row = document.createElement('div');
        row.className = 'shader-toggle-row';
        row.innerHTML = `<span class="shader-label">${label}</span><span class="shader-toggle-switch"></span>`;
        row.onclick = () => {
          const enabled = !row.classList.contains('active');
          row.classList.toggle('active', enabled);
          toggleShaderEffect(id, enabled);
          shaderClearBtn.disabled = activeShaderEffects.size === 0;
        };
        shaderToggles.appendChild(row);
        shaderToggleRows[id] = row;
      }
      if (shaderClearBtn) {
        shaderClearBtn.onclick = () => {
          for (const id of Object.keys(effectLabels)) {
            if (activeShaderEffects.has(id)) {
              toggleShaderEffect(id, false);
              shaderToggleRows[id]?.classList.remove('active');
            }
          }
          shaderClearBtn.disabled = true;
        };
      }
    }

    // 显示基准测试面板
    const benchPanel = document.getElementById('bench-panel');
    if (benchPanel) {
      benchPanel.style.display = 'block';
      const startBtn = document.getElementById('bench-start-btn');
      const stopBtn = document.getElementById('bench-stop-btn');
      const exportBtn = document.getElementById('bench-export-btn');
      if (startBtn) startBtn.onclick = () => {
        bench.active = true;
        startBenchCollection();
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        showInfo('性能采集已开始 (10s)...');
        setTimeout(() => {
          if (bench.collecting) {
            stopBenchCollection();
            const stats = computeStats();
            if (stats) {
              bench.results.push({
                scene: sceneData[currentSceneId].title,
                format: currentFormat.toUpperCase(),
                splatCount: sceneData[currentSceneId].splatCount,
                loadTime: bench.loadTime,
                ...stats,
              });
              renderBenchReport();
            }
            startBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
            bench.active = false;
            showInfo('性能采集完成, 结果已记录');
          }
        }, bench.collectDuration);
      };
      if (stopBtn) stopBtn.onclick = () => {
        stopBenchCollection();
        const stats = computeStats();
        if (stats) {
          bench.results.push({
            scene: sceneData[currentSceneId].title,
            format: currentFormat.toUpperCase(),
            splatCount: sceneData[currentSceneId].splatCount,
            loadTime: bench.loadTime,
            ...stats,
          });
          renderBenchReport();
        }
        startBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
        bench.active = false;
        showInfo('性能采集已停止, 结果已记录');
      };
      if (exportBtn) exportBtn.onclick = exportBenchReport;
      updateBenchStats();
      renderBenchReport();
    }
  });

  // FPS 监控 + 帧时间记录
  const keyEls = {
    w: document.getElementById('key-w'),
    a: document.getElementById('key-a'),
    s: document.getElementById('key-s'),
    d: document.getElementById('key-d'),
    q: document.getElementById('key-q'),
    e: document.getElementById('key-e'),
  };

  /**
   * ★ FPS 监控回调工厂 — 三处注册点 (初始/后端切换/回退) 共用同一实现, 避免多副本漂移。
   *
   * 帧间断保护: 帧间隔 > 250ms 说明 RAF 曾被中断 (页面隐藏暂停/长阻塞任务/
   * 渲染器切换)。此时统计窗口横跨中断期, 直接平均会算出错误低值 (如后台恢复后瞬间的 "FPS: 7"), 需重启窗口。
   */
  function createHudCallback() {
    let lastFrameAt = performance.now();
    return () => {
      recordFrame();
      frameCount++;
      const now = performance.now();

      const activeKeys = renderer.getActiveMoveKeys ? renderer.getActiveMoveKeys() : [];
      for (const [k, el] of Object.entries(keyEls)) {
        if (el) el.classList.toggle('active', activeKeys.includes(k));
      }

      if (now - lastFrameAt > 250) {
        // 帧间断: 重启窗口 (当前帧计入), 不基于陈旧时间基线计算/刷新 HUD,
        // 保留中断前最后一次有效 FPS 显示, 下一窗口自动恢复正常值。
        frameCount = 1;
        fpsTimer = now;
      } else if (now - fpsTimer >= 500) {
        fps = Math.round((frameCount * 1000) / (now - fpsTimer));
        frameCount = 0;
        fpsTimer = now;
        const resScale = renderer.getResolutionScale ? renderer.getResolutionScale() : 1.0;
        const isolated = RenderManager.isCrossOriginIsolated() ? '✓' : '✗';
        const lodStatus = renderer.isLodReady ? (renderer.isLodReady() ? '✓' : '✗') : '—';
        const gpuInfo = webgpuCapability?.adapterInfo
          ? `${webgpuCapability.adapterInfo.vendor} ${webgpuCapability.adapterInfo.architecture}`
          : 'N/A';
        const gpuType = webgpuCapability?.gpuType ? ` [${webgpuCapability.gpuType}]` : '';
        const scene = sceneData[currentSceneId];
        hudEl.innerHTML = [
          `Backend: ${backend.toUpperCase()} | Tier: ${tierNames[tier]} | FPS: ${fps}`,
          `GPU: ${gpuInfo}${gpuType} | SAB: ${isolated} | LOD: ${lodStatus}`,
          `Scene: ${scene?.title} (${scene?.splatCount}) | Format: ${currentFormat.toUpperCase()} | Res: ${(resScale * 100).toFixed(0)}%`,
        ].join('<br>');

        if (bench.collecting) updateBenchStats();
      }
      lastFrameAt = now;
    };
  }

  frameUnsub = renderer.onFrame(createHudCallback());

  // ── 事件 ──
  player.on('scene:switched', (data) => {
    const d = data;
    showInfo(`已切换到场景: ${d?.sceneId || ''}`);
    updateSelector(d?.sceneId);
    currentSceneId = d?.sceneId || currentSceneId;
    window.__currentSceneId = currentSceneId; // 供外部/测试读取当前场景
    updateFormatPanel();
  });

  player.on('error', ({ message }) => {
    loading.style.display = 'none';
    errorEl.textContent = '❌ ' + message;
    errorEl.style.display = 'block';
  });

  function showInfo(text) {
    let el = document.getElementById('info');
    if (!el) {
      el = document.createElement('div');
      el.id = 'info';
      container.appendChild(el);
    }
    el.textContent = text;
  }

  function updateSelector(activeId) {
    selectorEl.innerHTML = '';
    for (const id of Object.keys(config.scenes)) {
      const btn = document.createElement('button');
      btn.textContent = `${config.scenes[id].title}`;
      btn.className = id === activeId ? 'active' : '';
      btn.onclick = async () => {
        if (isSwitching || id === activeId) return;
        await switchScene(id);
      };
      selectorEl.appendChild(btn);
    }
  }

  function updateFormatPanel() {
    const formatToggles = document.getElementById('format-toggles');
    if (!formatToggles) return;
    const formatKeys = ['ply', 'splat', 'spz', 'sog'];
    const rows = formatToggles.querySelectorAll('.format-toggle-row');
    rows.forEach((row, idx) => {
      const fmt = formatKeys[idx];
      if (!fmt) return;
      const scene = sceneData[currentSceneId];
      if (!scene) return;
      const fmtData = scene.formats[fmt];
      const sizeEl = row.querySelector('.format-size');
      if (sizeEl) sizeEl.textContent = fmtData.size;
      const isDisabled = !fmtData.url;
      row.classList.toggle('disabled', isDisabled);
      row.classList.toggle('active', fmt === currentFormat);
      // Re-bind onclick
      row.onclick = isDisabled ? null : async () => {
        if (isSwitching || fmt === currentFormat) return;
        row.classList.add('active');
        document.querySelectorAll('.format-toggle-row').forEach(r => {
          if (r !== row) r.classList.remove('active');
        });
        await switchFormat(fmt);
      };
    });
  }

  async function switchScene(sceneId) {
    if (isSwitching) return;
    isSwitching = true;
    loading.style.display = 'block';
    loadingText.textContent = `加载场景: ${config.scenes[sceneId]?.title || sceneId}...`;
    bench.loadStartTime = performance.now();

    try {
      currentSceneId = sceneId;
      applyFormatToConfig();
      await player.switchScene(sceneId);
      bench.loadTime = performance.now() - bench.loadStartTime;
      updateSelector(sceneId);
      updateFormatPanel();
    } catch (err) {
      console.error('场景切换失败:', err);
      errorEl.textContent = '❌ 场景切换失败: ' + (err instanceof Error ? err.message : String(err));
      errorEl.style.display = 'block';
    } finally {
      loading.style.display = 'none';
      isSwitching = false;
    }
  }

  async function switchFormat(format) {
    if (isSwitching) return;
    isSwitching = true;
    loading.style.display = 'block';
    const scene = sceneData[currentSceneId];
    loadingText.textContent = `加载 ${format.toUpperCase()} 格式 (${scene?.title || currentSceneId})...`;
    bench.loadStartTime = performance.now();

    try {
      currentFormat = format;
      const fmtData = scene?.formats[format];
      if (!fmtData || !fmtData.url) throw new Error(`格式 ${format} 不可用`);

      const loadOptions = {
        onProgress: (loaded, total) => {
          if (total > 0) {
            const pct = Math.round((loaded / total) * 100);
            loadingText.textContent = `加载 ${format.toUpperCase()} 格式... ${pct}%`;
          }
        },
        onFirstFrame: () => {
          loading.style.display = 'none';
          showInfo(`${format.toUpperCase()} 首帧已渲染`);
        },
      };

      if (format === 'sog') {
        const splatUrl = scene.formats.splat.url;
        await renderer.loadScene(splatUrl, {
          ...loadOptions,
          lodSource: fmtData.url,
        });
      } else {
        await renderer.loadScene(fmtData.url, loadOptions);
      }

      bench.loadTime = performance.now() - bench.loadStartTime;
      showInfo(`格式切换: ${format.toUpperCase()} | ${scene?.title} | ${scene?.splatCount} splats | 加载 ${formatNum(bench.loadTime, 0)}ms`);
      updateFormatPanel();
    } catch (err) {
      console.error('格式切换失败:', err);
      errorEl.textContent = '❌ 格式切换失败: ' + (err instanceof Error ? err.message : String(err));
      errorEl.style.display = 'block';
      setTimeout(() => { errorEl.style.display = 'none'; }, 5000);
    } finally {
      loading.style.display = 'none';
      isSwitching = false;
    }
  }

  function applyFormatToConfig() {
    const scene = sceneData[currentSceneId];
    const sceneConfig = config.scenes[currentSceneId];
    if (!scene || !sceneConfig) return;

    const fmtData = scene.formats[currentFormat];
    if (!fmtData || !fmtData.url) {
      // 回退到 splat
      sceneConfig.source = scene.formats.splat.url;
      sceneConfig.lodSource = undefined;
      return;
    }

    if (currentFormat === 'sog') {
      sceneConfig.source = scene.formats.splat.url;
      sceneConfig.lodSource = fmtData.url;
    } else {
      sceneConfig.source = fmtData.url;
      sceneConfig.lodSource = undefined;
    }
  }

  // ── 后端切换 ──────────────────────────────────────────────

  /**
   * 切换渲染后端 (auto / webgl2 / webgpu)
   * 销毁旧渲染器 → 创建新渲染器 → 重新加载当前场景
   * ★ 安全: 切换前检查 WebGPU 能力, 显示实验性警告
   */
  async function switchBackend(mode) {
    if (mode === currentBackendMode) return;
    if (isSwitching) return;

    // ★ WebGPU 能力预检查
    if (mode === 'webgpu') {
      // 仅强制 WebGPU 时才检查 (Auto 模式会自动回退到 WebGL2)
      if (!webgpuCapability || !webgpuCapability.supported) {
        const reason = webgpuCapability?.reason || '未知原因';
        errorEl.textContent = `❌ WebGPU 不可用: ${reason}`;
        errorEl.style.display = 'block';
        setTimeout(() => { errorEl.style.display = 'none'; }, 5000);
        return;
      }
      // ★ 实验性警告
      const gpuInfo = webgpuCapability.adapterInfo
        ? `${webgpuCapability.adapterInfo.vendor} ${webgpuCapability.adapterInfo.architecture}`
        : '未知 GPU';
      console.warn('[后端切换] WebGPU 渲染器是实验性功能, 可能不稳定。GPU:', gpuInfo);
    }

    isSwitching = true;

    loading.style.display = 'block';
    loadingText.textContent = `切换到 ${mode === 'auto' ? 'Auto' : mode === 'webgl2' ? 'WebGL' : 'WebGPU'} 后端...`;
    errorEl.style.display = 'none';

    try {
      // 1. 注销旧的帧回调
      if (frameUnsub) { frameUnsub(); frameUnsub = null; }

      // 2. 销毁旧渲染器 (会移除 canvas DOM)
      renderer.destroy();

      // 3. 创建新渲染器 (★ 添加超时保护)
      const initPromise = createAndInitRenderer(mode);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('渲染器初始化超时 (10s)')), 10000)
      );
      const result = await Promise.race([initPromise, timeoutPromise]);

      renderer = result.renderer;
      backend = result.backend;
      webgpuCapability = result.webgpuCapability;
      currentBackendMode = mode;
      tier = renderer.getDeviceTier();

      // 4. 设置到 player 并启动
      player.setRenderer(renderer);
      renderer.start();

      // 5. 重新设置帧回调 (FPS 监控等) — 共用 createHudCallback, 帧间断保护自动生效
      frameUnsub = renderer.onFrame(createHudCallback());

      // 6. 重新加载当前场景 (使用当前格式)
      applyFormatToConfig();
      const scene = sceneData[currentSceneId];
      const fmtData = scene?.formats[currentFormat];
      bench.loadStartTime = performance.now();

      if (currentFormat === 'sog' && fmtData?.url) {
        await renderer.loadScene(scene.formats.splat.url, { lodSource: fmtData.url });
      } else if (fmtData?.url) {
        await renderer.loadScene(fmtData.url);
      }
      bench.loadTime = performance.now() - bench.loadStartTime;

      // 7. 更新 UI
      updateBackendPanel();
      const backendLabel = backend === 'webgpu' ? 'WebGPU (实验性)' : 'WebGL2';
      showInfo(`已切换到 ${backendLabel} 后端 | ${scene?.title} | ${currentFormat.toUpperCase()}`);
    } catch (err) {
      console.error('后端切换失败:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      errorEl.textContent = `❌ 后端切换失败: ${errMsg}${mode === 'webgpu' ? ' (WebGPU 是实验性功能, 建议使用 WebGL2)' : ''}`;
      errorEl.style.display = 'block';
      // ★ 自动回退到 WebGL2
      try {
        const fallbackResult = await createAndInitRenderer('webgl2');
        renderer = fallbackResult.renderer;
        backend = fallbackResult.backend;
        webgpuCapability = fallbackResult.webgpuCapability;
        currentBackendMode = 'webgl2';
        tier = renderer.getDeviceTier();
        player.setRenderer(renderer);
        renderer.start();

        // 重新设置帧回调 — 共用 createHudCallback
        frameUnsub = renderer.onFrame(createHudCallback());

        // 重新加载场景
        applyFormatToConfig();
        const scene = sceneData[currentSceneId];
        const fmtData = scene?.formats[currentFormat];
        if (fmtData?.url) {
          await renderer.loadScene(fmtData.url);
        }
        showInfo('已自动回退到 WebGL2 后端');
      } catch (fallbackErr) {
        console.error('WebGL2 回退也失败:', fallbackErr);
        // ★ renderer 已销毁且重建失败 → 置 null, 避免后续操作已销毁对象
        renderer = null;
        webgpuCapability = null;
        errorEl.textContent = `❌ 渲染器初始化失败: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)} (请刷新页面重试)`;
        errorEl.style.display = 'block';
      }
      updateBackendPanel();
    } finally {
      loading.style.display = 'none';
      isSwitching = false;
    }
  }

  /** 更新后端切换面板按钮状态 */
  function updateBackendPanel() {
    const btns = document.querySelectorAll('#backend-panel .backend-btn');
    // ★ GPU 类型标签
    const gpuTypeLabel = webgpuCapability?.gpuType ? ` [${webgpuCapability.gpuType}]` : '';
    btns.forEach(btn => {
      const mode = btn.dataset.mode;
      btn.classList.toggle('active', mode === currentBackendMode);
      // WebGPU 按钮在不可用时禁用
      if (mode === 'webgpu' && webgpuCapability && !webgpuCapability.supported) {
        btn.disabled = true;
        btn.title = `WebGPU 不可用: ${webgpuCapability.reason || '未知原因'}`;
      } else if (mode === 'webgpu' && webgpuCapability?.supported) {
        btn.title = `WebGPU 渲染器 (实验性)${gpuTypeLabel}`;
      } else if (mode === 'auto' && webgpuCapability && !webgpuCapability.supported) {
        btn.title = `Auto 将回退到 WebGL2 (WebGPU 不可用)`;
      } else {
        btn.disabled = false;
        btn.title = '';
      }
    });
  }

  // 绑定后端切换按钮
  document.querySelectorAll('#backend-panel .backend-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode && mode !== currentBackendMode && !btn.disabled) {
        switchBackend(mode);
      }
    });
  });

  // ── 加载 ──
  loadingText.textContent = '加载场景配置...';
  await player.load(config);

  // ── 切换到第一个场景 ──
  loadingText.textContent = '加载 3DGS 数据...';
  bench.loadStartTime = performance.now();
  await player.switchScene('kitchen');
  bench.loadTime = performance.now() - bench.loadStartTime;

  // 初始化后端面板状态
  updateBackendPanel();

  // ── 自动化测试接口 (供 Playwright 调用) ──
  window.__bench = bench;
  window.__sceneData = sceneData;
  window.__renderer = renderer;
  window.__backend = backend;
  window.__webgpuCapability = webgpuCapability;

  window.__getDeviceInfo = function() {
    const gpuInfo = webgpuCapability?.adapterInfo
      ? `${webgpuCapability.adapterInfo.vendor} ${webgpuCapability.adapterInfo.architecture}` : 'N/A';
    return {
      backend: backend.toUpperCase(),
      // ★ renderer 可能为 null (初始/回退失败) — 守卫避免 TypeError
      deviceTier: renderer ? tierNames[renderer.getDeviceTier()] : 'N/A',
      gpu: gpuInfo,
      sab: RenderManager.isCrossOriginIsolated(),
      resolutionScale: renderer && renderer.getResolutionScale ? renderer.getResolutionScale() : 1.0,
      userAgent: navigator.userAgent,
    };
  };

  window.__switchScene = async function(sceneId) {
    await switchScene(sceneId);
    // 等待稳定
    await new Promise(r => setTimeout(r, 2000));
  };

  window.__switchFormat = async function(format) {
    const scene = sceneData[currentSceneId];
    const fmtData = scene?.formats[format];
    if (!fmtData || !fmtData.url) {
      return false; // 格式不可用
    }
    await switchFormat(format);
    // 等待稳定
    await new Promise(r => setTimeout(r, 3000));

    // ★ P0: 等待 LOD 就绪 (SOG 非阻塞构建需要时间)
    //   createLodSplats() 在 Web Worker 中执行, 大场景需 8-80 秒
    //   不等待 LOD 就绪会导致采集窗口内 FPS 极低 (LOD 消隐未生效)
    if (renderer.isLodReady) {
      const lodTimeoutMs = 120000; // 最多等 120 秒
      const lodStart = performance.now();
      while (!renderer.isLodReady() && (performance.now() - lodStart) < lodTimeoutMs) {
        await new Promise(r => setTimeout(r, 500));
      }
      const lodWait = performance.now() - lodStart;
      if (renderer.isLodReady()) {
        console.log(`[Bench] LOD 就绪, 额外等待 ${(lodWait / 1000).toFixed(1)}s`);
      } else {
        console.warn(`[Bench] LOD 等待超时 (${(lodTimeoutMs / 1000).toFixed(0)}s), 继续采集`);
      }
    }

    return true;
  };

  window.__runBench = function(durationMs) {
    return new Promise((resolve) => {
      bench.frameTimes = [];
      bench.fpsHistory = [];
      bench.collecting = true;
      bench.lastFrameTime = performance.now();
      const dur = durationMs || bench.collectDuration;
      setTimeout(() => {
        bench.collecting = false;
        const stats = computeStats();
        resolve(stats ? {
          scene: sceneData[currentSceneId].title,
          format: currentFormat.toUpperCase(),
          splatCount: sceneData[currentSceneId].splatCount,
          loadTime: bench.loadTime,
          ...stats,
        } : null);
      }, dur);
    });
  };

  window.__autoBench = async function(onProgress) {
    const sceneIds = ['kitchen', 'demo1', 'storysplat', 'demo2', 'garden'];
    const formats = ['ply', 'splat', 'spz', 'sog'];
    const results = [];

    for (const sceneId of sceneIds) {
      // 切换场景
      try {
        await switchScene(sceneId);
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error(`场景切换失败: ${sceneId}`, err);
        continue;
      }

      for (const format of formats) {
        const scene = sceneData[sceneId];
        const fmtData = scene?.formats[format];
        if (!fmtData || !fmtData.url) {
          results.push({
            scene: scene.title, format: format.toUpperCase(),
            splatCount: scene.splatCount, error: 'N/A (无源文件)',
          });
          if (onProgress) onProgress(results.length, sceneIds.length * formats.length, scene.title, format, 'skipped');
          continue;
        }

        try {
          await switchFormat(format);
          await new Promise(r => setTimeout(r, 3000));

          if (onProgress) onProgress(results.length, sceneIds.length * formats.length, scene.title, format, 'running');

          const result = await new Promise((resolve) => {
            bench.frameTimes = [];
            bench.fpsHistory = [];
            bench.collecting = true;
            bench.lastFrameTime = performance.now();
            setTimeout(() => {
              bench.collecting = false;
              const stats = computeStats();
              resolve(stats ? {
                scene: scene.title,
                format: format.toUpperCase(),
                splatCount: scene.splatCount,
                loadTime: bench.loadTime,
                ...stats,
              } : null);
            }, bench.collectDuration);
          });

          if (result) {
            results.push(result);
            if (onProgress) onProgress(results.length, sceneIds.length * formats.length, scene.title, format, 'done');
          }
        } catch (err) {
          results.push({
            scene: scene.title, format: format.toUpperCase(),
            splatCount: scene.splatCount, error: err.message,
          });
          if (onProgress) onProgress(results.length, sceneIds.length * formats.length, scene.title, format, 'error');
        }
      }
    }

    return results;
  };

  window.__benchReady = true;
  window.__currentSceneId = currentSceneId; // 当前场景 id (供外部/测试读取)
  // 调试探针 (供验证脚本定位媒体投影)
  window.__cameraForwardPoint = cameraForwardPoint;
  window.__getMediaPose = () => extractCameraPose(renderer.getViewProjectionMatrix());
  window.__getMediaOverlaySize = () => {
    const ov = document.querySelector('[class*="3dgs-media-overlay"]');
    return ov ? { w: ov.clientWidth, h: ov.clientHeight, perspective: ov.style.perspective } : null;
  };
}

main().catch((err) => {
  console.error(err);
  const errorEl = document.getElementById('error');
  const loading = document.getElementById('loading');
  loading.style.display = 'none';
  errorEl.textContent = '❌ ' + (err instanceof Error ? err.message : String(err));
  errorEl.style.display = 'block';
});
