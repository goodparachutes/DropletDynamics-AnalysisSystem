/** 射流动力学主图：曲线勾选项的浏览器原生 title（与空泡/铺展主图一致） */
export const JET_CURVE_METRIC_TOOLTIPS = {
  zTip:
    'Z_c（mm）：有 LS 椭圆时为椭圆中心相对 Surface Y 的高度，向上为正；无椭圆时为连通域形心同一标高。',
  vJet:
    'V_jet（mm/s）：Z_c 对撞击标定 t（ms）**整条轨迹**一元最小二乘直线的斜率 ×1000（弹道拟合 Z≈Vt+Z₀）；**不再**使用逐帧差分或 SG。',
  area: 'A_drop（mm²）：LS 椭圆面积 πab；无椭圆时为像素面积×(mm/px)²。',
  vol: 'Vol（mm³）：4/3·π·a·b²（a≥b 为椭圆半轴 mm）；无椭圆时为等效球 πD³/6。',
  ar: 'AR：椭圆长宽比 a/b（≥1）；无椭圆时为包围盒高/宽。',
  ellipseA: 'a（mm）：椭圆长半轴（LS 拟合）；无拟合时为空。',
  ellipseB: 'b（mm）：椭圆短半轴（LS 拟合）；无拟合时为空。',
  phiDeg: 'φ（°）：椭圆长轴相对 +x 转角；无拟合时为空。',
  ek: 'E_k（J）：**锁定** ½ρ⟨V⟩²·⟨V_sphere⟩；⟨V⟩ 为各帧 vol 的算术平均（m³），速度为弹道拟合常数 V_jet（m/s）；ρ 为侧栏流体密度。',
  efficiencyEta:
    'η（无量纲）：E_k/E_in；E_k 为弹道锁定动能；E_in 见 macro 注释；需撞击速度 U₀ 等。',
  amplificationBeta:
    'β（无量纲）：(V_jet/U₀)²；V_jet 为弹道拟合常数（已换 m/s），U₀ 为撞击速度分析结果（m/s）。',
} as const
