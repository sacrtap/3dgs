/**
 * WebGPU 高斯泼溅渲染着色器 (WGSL)
 *
 * ★ TD-05: 从 webgpu-render-manager.ts 独立成文件, 降低决策密集文件行数。
 *   TD-01 增加 SH 求值时, 新 shader 也应落此目录。
 *
 * EWA 投影管线 (vs_main):
 *   1. 变换中心到 view space
 *   2. 构建 3D 协方差: Sigma = R * S * S * R^T
 *   3. 变换协方差到 view space: SigmaView = V * Sigma * V^T
 *   4. 透视投影 Jacobian
 *   5. 2D 屏幕协方差: Sigma2D = J * SigmaView * J^T (2×2)
 *   6. 低通滤波: Sigma2D += blur² * I (抗锯齿)
 *   7. conic = Sigma2D⁻¹ (逆协方差, 用于 fragment 高斯评估)
 *   8. 特征值 → quad 尺寸 (3σ 覆盖 ~99.7%)
 *   9. Fragment: power = uv^T * conic_scaled * uv, alpha = opacity * exp(-0.5 * power)
 *
 * [来源: 3DGS 论文 — Kerbl et al. 2023, EWA splatting]
 * [来源: Spark 着色器 — @sparkjsdev/spark splatVertex_default.glsl (参考)]
 * [来源: EWA Splatting — Zwicker et al. 2001, SIGGRAPH]
 */
export function SPLAT_RENDER_SHADER(_format: GPUTextureFormat): string {
  return /* wgsl */ `
// ★ TD-01: 球谐基函数归一化常数 (与 three.js SphericalHarmonics3 / Spark 一致)
const SH_C0 = 0.28209479177387814;
const SH_C1 = 0.4886025119029199;
const SH_C2 = 1.0925484305920792;
const SH_C3 = 0.31539156525252005;
const SH_C4 = 0.5462742152960396;

struct Uniforms {
  vpMatrix: mat4x4<f32>,
  viewMatrix: mat4x4<f32>,
  camPos: vec4<f32>,
  focal: vec2<f32>,
  splatCount: u32,
  time: f32,
  // ★ TD-01: 球谐阶数对应系数数 (0/3/8/15), 0 = 无 SH (占 _pad 区 160-163 字节)
  shDim: u32,
  _pad: vec3<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> scales: array<f32>;
@group(0) @binding(3) var<storage, read> colors: array<u32>;
@group(0) @binding(4) var<storage, read> rotations: array<u32>;
@group(0) @binding(5) var<storage, read> indices: array<u32>;
// ★ TD-01: 球谐非 DC 系数 (N × shDim × 3, 每 splat 每通道; 无 SH 时为 0 字节 buffer, 越界读返回 0)
@group(0) @binding(6) var<storage, read> shCoeffs: array<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) conic: vec3<f32>,
};

// ★ 辅助函数: 从四元数构建旋转矩阵
fn quatToMat3(q: vec4<f32>) -> mat3x3<f32> {
  let x = q.x;
  let y = q.y;
  let z = q.z;
  let w = q.w;
  return mat3x3<f32>(
    vec3<f32>(1.0 - 2.0 * (y*y + z*z), 2.0 * (x*y - w*z), 2.0 * (x*z + w*y)),
    vec3<f32>(2.0 * (x*y + w*z), 1.0 - 2.0 * (x*x + z*z), 2.0 * (y*z - w*x)),
    vec3<f32>(2.0 * (x*z - w*y), 2.0 * (y*z + w*x), 1.0 - 2.0 * (x*x + y*y))
  );
}

// ★ 安全的退化 splat 输出 (零面积三角形, GPU 自动跳过)
fn degenerateOutput() -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  output.color = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  output.uv = vec2<f32>(0.0);
  output.conic = vec3<f32>(0.0);
  return output;
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VertexOutput {
  let splatIdx = indices[iid];
  let px = positions[splatIdx * 3u];
  let py = positions[splatIdx * 3u + 1u];
  let pz = positions[splatIdx * 3u + 2u];
  let center = vec3<f32>(px, py, pz);

  // 读取 scale (3 floats, 已在线性空间 — .splat 格式存储 exp 后的值)
  let sx = scales[splatIdx * 3u];
  let sy = scales[splatIdx * 3u + 1u];
  let sz = scales[splatIdx * 3u + 2u];

  // 读取 rotation (4 uint8 packed in uint32) 并归一化到 [-1, 1]
  let rotPacked = rotations[splatIdx];
  let r_x = (f32((rotPacked >> 0u) & 0xFFu) - 128.0) / 128.0;
  let r_y = (f32((rotPacked >> 8u) & 0xFFu) - 128.0) / 128.0;
  let r_z = (f32((rotPacked >> 16u) & 0xFFu) - 128.0) / 128.0;
  let r_w = (f32((rotPacked >> 24u) & 0xFFu) - 128.0) / 128.0;
  let q = normalize(vec4<f32>(r_x, r_y, r_z, r_w));

  // ★ M4-P2.1: EWA 投影 — Step 1: 变换中心到 view space
  let centerView = uniforms.viewMatrix * vec4<f32>(center, 1.0);

  // ★ 安全检查: 跳过相机后面的 splat (Three.js 中 z < 0 为前方)
  if (centerView.z >= 0.0) {
    return degenerateOutput();
  }

  // ★ Step 2: 构建 3D 协方差矩阵: Sigma = R * S * S * R^T
  let R = quatToMat3(q);
  let S = mat3x3<f32>(
    vec3<f32>(sx, 0.0, 0.0),
    vec3<f32>(0.0, sy, 0.0),
    vec3<f32>(0.0, 0.0, sz)
  );
  let Sigma = R * S * S * transpose(R);

  // ★ Step 3: 变换协方差到 view space: SigmaView = V * Sigma * V^T
  // V = view matrix 的 3x3 旋转部分
  let V = mat3x3<f32>(
    uniforms.viewMatrix[0].xyz,
    uniforms.viewMatrix[1].xyz,
    uniforms.viewMatrix[2].xyz
  );
  let SigmaView = V * Sigma * transpose(V);

  // ★ Step 4: 透视投影 Jacobian
  // Three.js 透视投影: x_ndc = -fx * x_view / z, y_ndc = -fy * y_view / z
  // J = [[-fx/z, 0, fx*x/z²], [0, -fy/z, fy*y/z²], [0, 0, 0]]
  let z = centerView.z;
  let xv = centerView.x;
  let yv = centerView.y;
  let fx = uniforms.focal.x;
  let fy = uniforms.focal.y;
  let J00 = -fx / z;
  let J02 = fx * xv / (z * z);
  let J11 = -fy / z;
  let J12 = fy * yv / (z * z);

  // ★ Step 5: 计算 2D 屏幕空间协方差: Sigma2D = J * SigmaView * J^T (2×2)
  // 提取 SigmaView 对称元素 (M[col][row])
  let s00 = SigmaView[0][0];
  let s11 = SigmaView[1][1];
  let s22 = SigmaView[2][2];
  let s01 = SigmaView[1][0]; // = SigmaView[0][1]
  let s02 = SigmaView[2][0]; // = SigmaView[0][2]
  let s12 = SigmaView[2][1]; // = SigmaView[1][2]

  // Sigma2D[0][0] = J00² * s00 + 2 * J00 * J02 * s02 + J02² * s22
  // Sigma2D[0][1] = J00 * J11 * s01 + J02 * J11 * s12 + J00 * J12 * s02 + J02 * J12 * s22
  // Sigma2D[1][1] = J11² * s11 + 2 * J11 * J12 * s12 + J12² * s22
  var covXX = J00 * J00 * s00 + 2.0 * J00 * J02 * s02 + J02 * J02 * s22;
  var covXY = J00 * J11 * s01 + J02 * J11 * s12 + J00 * J12 * s02 + J02 * J12 * s22;
  var covYY = J11 * J11 * s11 + 2.0 * J11 * J12 * s12 + J12 * J12 * s22;

  // ★ Step 6: 低通滤波 (抗锯齿)
  // Sigma2D += blur² * I, blur=0.3 (与 WebGL 路径 HIGH/ULTRA 一致)
  let blurAmount = 0.3;
  covXX = covXX + blurAmount * blurAmount;
  covYY = covYY + blurAmount * blurAmount;

  // ★ Step 7: 计算 conic (逆协方差矩阵)
  let det = covXX * covYY - covXY * covXY;
  if (det <= 0.0) {
    return degenerateOutput();
  }
  let conicXX = covYY / det;
  let conicXY = -covXY / det;
  let conicYY = covXX / det;

  // ★ Step 8: 计算特征值确定 quad 尺寸
  let trace = covXX + covYY;
  let discriminant = sqrt(max(trace * trace - 4.0 * det, 0.0));
  let lambda1 = (trace + discriminant) * 0.5;
  let lambda2 = (trace - discriminant) * 0.5;
  let maxLambda = max(lambda1, lambda2);

  // ★ 安全检查: 跳过异常大的 splat
  if (maxLambda > 2500.0) {
    return degenerateOutput();
  }

  // 3σ 覆盖 ~99.7% 高斯能量
  let worldRadius = 3.0 * sqrt(max(maxLambda, 0.0));

  // ★ 投影 splat 中心到裁剪空间
  let centerClip = uniforms.vpMatrix * vec4<f32>(center, 1.0);

  // ★ 安全检查: 跳过相机后面的 splat
  if (centerClip.w <= 0.0) {
    return degenerateOutput();
  }

  // ★ 计算 NDC 半径
  let ndcRadius = clamp(worldRadius, 0.0, 0.3);

  // ★ 跳过亚像素 splat
  if (ndcRadius < 0.001) {
    return degenerateOutput();
  }

  // 生成 quad (6 vertices = 2 triangles)
  var quadPos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
  );
  let qp = quadPos[vid];

  // 透视除法得到 NDC 中心位置
  let centerNDC = centerClip.xyz / centerClip.w;

  // 屏幕对齐 quad: 在 NDC 空间偏移
  let offset = qp * ndcRadius;

  var output: VertexOutput;
  output.position = vec4<f32>(centerNDC.xy + offset, centerNDC.z, 1.0);
  output.uv = qp;

  // ★ 将 conic 按 quad 尺寸缩放后传递给 fragment
  // fragment 中: power = uv^T * conicScaled * uv
  // 其中 conicScaled = conic * ndcRadius² (因为 uv ∈ [-1,1] 映射到 ndcRadius 范围)
  let scale2 = ndcRadius * ndcRadius;
  output.conic = vec3<f32>(conicXX * scale2, conicXY * scale2, conicYY * scale2);

  // 解包 DC 颜色 (RGBA Uint8 packed in Uint32) — colors 流存的是 SH DC 系数 (≈0.5 附近)
  let colorPacked = colors[splatIdx];
  let dcR = f32((colorPacked >> 0u) & 0xFFu) / 255.0;
  let dcG = f32((colorPacked >> 8u) & 0xFFu) / 255.0;
  let dcB = f32((colorPacked >> 16u) & 0xFFu) / 255.0;
  let dcA = f32((colorPacked >> 24u) & 0xFFu) / 255.0;

  // ★ TD-01: 球谐着色 — 视角依赖颜色 (与 three.js SphericalHarmonics3 基函数约定一致)
  //   SH 系数布局: 每 splat shDim×3 个 (系数主序, 每系数 R/G/B 三通道, 同 f_rest_* 顺序)
  //   final = SH_C0 * dc + Σ coeff_k * basis_k(viewDir)
  var outR = dcR;
  var outG = dcG;
  var outB = dcB;
  let shDim = uniforms.shDim;
  if (shDim >= 3u) {
    let viewDir = normalize(uniforms.camPos.xyz - center);
    let x = viewDir.x;
    let y = viewDir.y;
    let z = viewDir.z;
    let base = splatIdx * (shDim * 3u);
    // L1 (3 系数): basis = SH_C1 * [y, z, x]
    let l1y = SH_C1 * y;
    let l1z = SH_C1 * z;
    let l1x = SH_C1 * x;
    outR = SH_C0 * dcR + shCoeffs[base] * l1y + shCoeffs[base + 3u] * l1z + shCoeffs[base + 6u] * l1x;
    outG = SH_C0 * dcG + shCoeffs[base + 1u] * l1y + shCoeffs[base + 4u] * l1z + shCoeffs[base + 7u] * l1x;
    outB = SH_C0 * dcB + shCoeffs[base + 2u] * l1y + shCoeffs[base + 5u] * l1z + shCoeffs[base + 8u] * l1x;
    if (shDim >= 8u) {
      // L2 (5 系数): basis = [SH_C2*xy, SH_C3*(3z²-1), SH_C2*yz, SH_C2*xz, SH_C4*(x²-y²)]
      let l2a = SH_C2 * x * y;
      let l2b = SH_C3 * (3.0 * z * z - 1.0);
      let l2c = SH_C2 * y * z;
      let l2d = SH_C2 * x * z;
      let l2e = SH_C4 * (x * x - y * y);
      outR += shCoeffs[base + 9u] * l2a + shCoeffs[base + 12u] * l2b
            + shCoeffs[base + 15u] * l2c + shCoeffs[base + 18u] * l2d
            + shCoeffs[base + 21u] * l2e;
      outG += shCoeffs[base + 10u] * l2a + shCoeffs[base + 13u] * l2b
            + shCoeffs[base + 16u] * l2c + shCoeffs[base + 19u] * l2d
            + shCoeffs[base + 22u] * l2e;
      outB += shCoeffs[base + 11u] * l2a + shCoeffs[base + 14u] * l2b
            + shCoeffs[base + 17u] * l2c + shCoeffs[base + 20u] * l2d
            + shCoeffs[base + 23u] * l2e;
    }
  }
  output.color = vec4<f32>(clamp(outR, 0.0, 1.0), clamp(outG, 0.0, 1.0), clamp(outB, 0.0, 1.0), dcA);

  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  // ★ M4-P2.1: 正确的 2D 椭圆高斯衰减
  // power = uv^T * conic * uv
  //   = u² * conicXX + 2 * u * v * conicXY + v² * conicYY
  // alpha = opacity * exp(-0.5 * power)
  let u = input.uv.x;
  let v = input.uv.y;
  let dist2 = u * u + v * v;
  if (dist2 > 1.0) {
    discard;
  }
  let power = u * (input.conic.x * u + input.conic.y * v)
            + v * (input.conic.y * u + input.conic.z * v);
  let gaussian = exp(-0.5 * power);
  let alpha = input.color.a * gaussian;

  return vec4<f32>(input.color.rgb * alpha, alpha);
}
`;
}
