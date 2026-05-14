export interface OverlayDisplayState {
  baseline: boolean
  autoCalibCircle: boolean
  impactVelocity: boolean
  spreadFit: boolean
  /** 选中帧上绘制接触角拟合示意：回归采样点、拟合直线、固面/界面射线与夹角扇形 */
  contactAngleConstruction: boolean
  /** 空泡动力学：在曲线点击选帧并提取后，主画面叠加 SG 平滑闭合轮廓（与接触角示意无关） */
  bubbleCavityContourOverlay: boolean
  /** 射流动力学：曲线选点后叠加当前滴的 Moore 外轮廓（ROI 内二值连通域） */
  jetDynamicsContourOverlay: boolean
  scaleBar: boolean
}

/** 默认仅开启基准线；其余标注需手动勾选，避免「勾一项却看到多项」的混淆 */
export const defaultOverlayDisplay: OverlayDisplayState = {
  baseline: true,
  autoCalibCircle: false,
  impactVelocity: false,
  spreadFit: false,
  contactAngleConstruction: false,
  bubbleCavityContourOverlay: false,
  jetDynamicsContourOverlay: false,
  scaleBar: false,
}
