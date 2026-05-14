export type InteractionMode = 'idle' | 'calibrating_scale'

export interface CalibrationPoint {
  x: number
  y: number
}

export interface AutoCalibrationResult {
  dropletX: number
  dropletY: number
  radius: number
  dPx: number
}

export interface AnalysisPoint {
  time: number
  absTime: number
  beta: number
  absDiameter: number
  subL?: number
  subR?: number
  ptsL?: CalibrationPoint[]
  ptsR?: CalibrationPoint[]
  /**
   * 液滴外轮廓闭合链（图像坐标 x→右、y→下），由二值 mask + flood-fill + Moore 追踪得到；
   * 表面能 A_wa / 体积积分优先使用该轮廓而非 ptsL/ptsR 样条采样。
   */
  outerContourPx?: CalibrationPoint[]
  /**
   * 本帧 Moore 外轮廓是否成功（闭合链点数 ≥ 12）。
   * 无效帧可能沿用上一帧 `outerContourPx`，此时此处仍为 false；旧数据未写入则依赖外层数推断。
   */
  mooreContourExtractOk?: boolean
  /**
   * 单帧掩码橡皮擦：圆域内强制为背景后再做 Moore（去除滴内误连通等）。
   */
  manualSuppressCircles?: Array<{ x: number; y: number; rPx: number }>
  /**
   * 仅亮度分割时：本帧二值化阈值覆盖（0–255）；不设则用侧栏全局阈值。
   * 由「备用阈值重试轮廓」写入；用于滴内背光等与全局阈值不一致的单帧。
   */
  contourPerFrameThreshold?: number
  /**
   * 仅背景差分分割时：本帧 |ΔI−I_bg| 二值阈值覆盖（与侧栏差分滑块同范围）；不设则用全局差分阈值。
   * 由「掩码橡皮擦」保存写入。
   */
  contourPerFrameDiffThreshold?: number
  /**
   * Moore 起点使用「单行从左向右」射线（近似 surfaceY−3），只追踪射线首先碰到的外壳边界；
   * 减轻全图扫描时误跟滴内封闭空洞轮廓的情况。
   */
  mooreStrictOuterRaySeed?: boolean
  /** 左侧动态接触角（°），由接触线附近轮廓线性回归得到 */
  contactAngleLeftDeg?: number
  /** 右侧动态接触角（°） */
  contactAngleRightDeg?: number
  /** 左右 θ 平均（°），仅当左右均有有效值时写出 */
  contactAngleAvgDeg?: number
  /**
   * 本帧 θ 拟合精度覆盖（0–100），与「图像设置」全局拟合精度含义相同；不设则沿用全局。
   * 影响直线回归带深/点数与青样条竖直带。
   */
  contactAngleFitPrecision?: number
  isInvalid?: boolean
  recoveredByNeck?: boolean
}

export interface AnalysisConfig {
  threshold: number
  samplingFps: number
  exportedFps: number
  actualD0: number
  zeroTime: number
  pixelScale: number | null
  surfaceY: number | null
}
