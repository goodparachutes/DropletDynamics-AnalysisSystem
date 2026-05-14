/** 侧栏表格、主图曲线等：中文名 + 物理含义 + 公式（用于 title / Tooltip） */

const BR = '\n'

export const cavityFrameTooltip =
  '帧索引 frame：与主区「帧 a/b」一致，按导出帧率 fe 对视频寻址；相邻整数帧在视频上的时间间隔为 1000/fe（ms）。'

export const cavityTimeMsTooltip =
  '时间 t（ms）：物理时间轴按侧栏「采样 fs」计算，t_ms = frame × (1000/fs)。故相邻帧在曲线上的 Δt_ms = 1000/fs（例如 fs=5000 ⇒ 0.2 ms/步；若你期望 2 ms/步，应对应 fs=500 Hz）。与视频寻址 fe 可不同。'

export const cavityAbTooltip =
  'A_b（气泡面积）：最大连通域掩膜的物理面积，mm²。公式：A_b = N_px × (mm/px)²，N_px 为域内像素数。'

export const cavityReqTooltip =
  'R_eq（等效半径）：与 A_b 同源的等效圆半径，mm。公式：R_eq = √(A_b / π)。非对轮廓单独圆拟合。'

export const cavityZcTooltip =
  'Z_c（形心高度）：气泡形心相对基准面的竖直坐标，mm，向上为正。公式：Z_c = (SurfaceY_px − y_c,px) × (mm/px)；未设 Surface Y 时为 —。'

export const cavityArTooltip =
  'AR（长宽比）：Moore 外轮廓轴对齐包围盒 (y_max−y_min)/(x_max−x_min)。细长条 AR 大、扁片 AR 小；超出 [0.2, 5] 判为非泡杂质。'

export const cavityKappaMmTooltip =
  'κ（1/mm）：顶点邻域平均曲率（物理）。曲率为长度倒数，公式：κ_mm = κ_px / (mm/px)，不可乘标定。'

export const cavityKappaPxTooltip =
  'κ（1/px）：像素空间曲率，SG 平滑链上「最上侧」顶点附近平均离散曲率。'

export const cavityVrTooltip =
  'V_r（径向速率）：dR_eq/dt，mm/s，对 SG 平滑后的 R_eq 序列中心差分。负：半径减小（向内坍塌）；正：膨胀。'

export const cavityVrAbsTooltip =
  '|V_r|（溃灭速率模）：|dR_eq/dt|，mm/s，与 V_r 同帧，表示径向变化速率的模。'

export const cavityVzTooltip =
  'V_z（形心竖直速度）：dZ_c/dt，mm/s，Z 向上为正。'

export const cavityDeltaPTooltip =
  'ΔP（拉普拉斯压差）：ΔP = 2σ / R，σ 为表面张力（N/m），R = R_eq 换算为 m，结果 Pa。'

export const cavitySigmaTooltip =
  '表面张力 σ：用于 ΔP 的 Laplace 公式，单位 N/m（与 σ N/m 输入一致）。'

export const cavityMinPixelsTooltip =
  'min_pixels：最大连通域像素数下限；低于则视为溃灭/空洞消失。'

export const cavityFeSyncTooltip =
  '导出帧率 fe：与侧栏「时间标定」中 fe 同步；用于 t_video = frame/fe 对视频 seek，与主区 ±1 帧一致。'

export const cavityMmPerPxTooltip =
  'mm/px：物理标定，与侧栏空间标定 px/mm 互为倒数，自动同步。'

export const cavityOtsuRelaxEpsilonTooltip =
  'Otsu 松弛 ε（灰度 0–60）：在 invert 之前放宽二值分界。暗泡：前景 g≤T+ε；亮泡：前景 g>T−ε。用于压制腔内镜面/透射造成的弱假孔（不同 cSt 反光差异大时可快速扫参）。'

export const cavityMorphCloseDiskRadiusTooltip =
  '圆盘闭运算半径（0–24 px，0 表示跳过圆盘、仅 3×3 闭运算一次）。先膨胀后腐蚀，弥合尺度与半径相当的孔洞；半径过大易吞掉真实薄缘细节。'

/**
 * 主图「曲线显示」勾选：与接触线动力学相同，用原生 `title` 悬停显示（多行依浏览器）。
 * 将鼠标移到整条 label（含文字）上即可。
 */
export const CAVITY_CURVE_METRIC_TOOLTIPS = {
  req: `R_eq · 等效半径${BR}物理含义：与掩膜物理面积同源的泡尺度；不是对轮廓单独再做一次圆拟合。${BR}公式：R_eq = √(A_b / π)，单位 mm。`,

  ab: `A_b · 气泡面积${BR}物理含义：最大连通域（孔洞）在像平面上的投影面积，已换到物理长度。${BR}公式：A_b = N_px·(mm/px)²，单位 mm²。`,

  dP: `ΔP · 拉普拉斯压差${BR}物理含义：Young–Laplace 球近似下曲率引起的附加压差。${BR}公式：ΔP = 2σ/R，σ 为 N/m，R = R_eq 换为 m，得 Pa。`,

  vrAbs: `|V_r| · 径向速率模${BR}物理含义：等效半径随时间变化速率的绝对值，看溃灭快慢。${BR}公式：|V_r| = |dR_eq/dt|；R_eq 经 SG 后对时间中心差分，mm/s。`,

  zc: `Z_c · 形心高度${BR}物理含义：泡形心相对固–液基准线（Surface Y）的竖直位置，向上为正。${BR}公式：Z_c = (Y_surface − y_c,px)·(mm/px)，mm；未设基准线时为空。`,
} as const
