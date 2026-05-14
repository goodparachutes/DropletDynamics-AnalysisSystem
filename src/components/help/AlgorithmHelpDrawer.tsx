import { useEffect } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Box,
  Camera,
  CheckCheck,
  Filter,
  Flame,
  Gauge,
  GitBranch,
  LineChart,
  Shield,
  Sparkles,
  Target,
  Weight,
  X,
  Zap,
} from 'lucide-react'
import './algorithmHelpPanel.css'

function MathBlock({ html }: { html: string }) {
  return <div className="ah-formula-box" dangerouslySetInnerHTML={{ __html: html }} />
}

/** Slide 4：原稿 MathML 将 )² 误挂在 mo 上，已改为对 V(t) 整体平方 */
const MATH_EK_AFFINE = `
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <msub><mi>E</mi><mi>k</mi></msub><mo>(</mo><mi>t</mi><mo>)</mo>
    <mo>=</mo>
    <mfrac><mn>1</mn><mn>2</mn></mfrac>
    <mi>M</mi>
    <mo>[</mo>
    <msup>
      <mrow><msub><mi>V</mi><mrow><mi>c</mi><mi>m</mi></mrow></msub><mo>(</mo><mi>t</mi><mo>)</mo></mrow>
      <mn>2</mn>
    </msup>
    <mo>+</mo>
    <mfrac><mn>1</mn><mn>2</mn></mfrac>
    <msup>
      <mrow><msub><mi>V</mi><mrow><mi>s</mi><mi>p</mi><mi>r</mi><mi>e</mi><mi>a</mi><mi>d</mi></mrow></msub><mo>(</mo><mi>t</mi><mo>)</mo></mrow>
      <mn>2</mn>
    </msup>
    <mo>]</mo>
  </mrow>
</math>`.trim()

const MATH_COORD_R = `
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <mi>r</mi><mo>=</mo><mo>|</mo><msub><mi>u</mi><mi>i</mi></msub><mo>-</mo><msub><mi>u</mi><mrow><mi>c</mi><mi>e</mi><mi>n</mi><mi>t</mi><mi>e</mi><mi>r</mi></mrow></msub><mo>|</mo><mo>×</mo><mtext>scale</mtext>
  </mrow>
</math>`.trim()

const MATH_COORD_Z = `
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <mi>z</mi><mo>=</mo><mo>(</mo><msub><mi>v</mi><mrow><mi>b</mi><mi>a</mi><mi>s</mi><mi>e</mi></mrow></msub><mo>-</mo><msub><mi>v</mi><mi>i</mi></msub><mo>)</mo><mo>×</mo><mtext>scale</mtext>
  </mrow>
</math>`.trim()

const MATH_VOL = `
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <mi>V</mi><mo>=</mo><mo>-</mo><mi>π</mi><munder><mo>∫</mo><mi>C</mi></munder><msup><mi>r</mi><mn>2</mn></msup><mi>d</mi><mi>z</mi>
  </mrow>
</math>`.trim()

const MATH_ZCM = `
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <msub><mi>Z</mi><mrow><mi>c</mi><mi>m</mi></mrow></msub>
    <mo>=</mo>
    <mfrac>
      <mrow><mo>-</mo><mi>π</mi><munder><mo>∫</mo><mi>C</mi></munder><mi>z</mi><msup><mi>r</mi><mn>2</mn></msup><mi>d</mi><mi>z</mi></mrow>
      <mi>V</mi>
    </mfrac>
  </mrow>
</math>`.trim()

const MATH_WDISS = `
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <msub><mi>W</mi><mrow><mi>d</mi><mi>i</mi><mi>s</mi><mi>s</mi></mrow></msub><mo>(</mo><mi>t</mi><mo>)</mo>
    <mo>=</mo>
    <msub><mi>E</mi><mrow><mi>m</mi><mi>e</mi><mi>c</mi><mi>h</mi></mrow></msub><mo>(</mo><mn>0</mn><mo>)</mo>
    <mo>-</mo>
    <mo>[</mo><msub><mi>E</mi><mi>k</mi></msub><mo>(</mo><mi>t</mi><mo>)</mo><mo>+</mo><mi>Δ</mi><msub><mi>E</mi><mi>σ</mi></msub><mo>(</mo><mi>t</mi><mo>)</mo><mo>]</mo>
  </mrow>
</math>`.trim()

const MATH_PHI = `
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <mi>Φ</mi><mo>(</mo><mi>t</mi><mo>)</mo>
    <mo>=</mo>
    <mo>-</mo>
    <mfrac><mi>d</mi><mrow><mi>d</mi><mi>t</mi></mrow></mfrac>
    <mo>[</mo><msub><mi>E</mi><mi>k</mi></msub><mo>(</mo><mi>t</mi><mo>)</mo><mo>+</mo><msub><mi>E</mi><mi>σ</mi></msub><mo>(</mo><mi>t</mi><mo>)</mo><mo>]</mo>
  </mrow>
</math>`.trim()

export interface AlgorithmHelpDrawerProps {
  open: boolean
  onClose: () => void
}

export function AlgorithmHelpDrawer({ open, onClose }: AlgorithmHelpDrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <>
      <aside
        className="algorithm-help-drawer"
        id="algorithm-help-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="algorithm-help-title"
      >
        <div className="algorithm-help-toolbar">
          <span id="algorithm-help-title">方法论与算法流程</span>
          <button type="button" onClick={onClose} aria-label="关闭帮助">
            <X size={18} strokeWidth={2.25} />
          </button>
        </div>
        <div className="algorithm-help-scroll">
          <section className="ah-slide">
            <h2 className="ah-title-main">极端粘度下液滴撞击动力学</h2>
            <p className="ah-subtitle">界面提取与能量耗散的严密分析框架 (Methodology &amp; Analytics)</p>
          </section>

          <section className="ah-slide">
            <h3 className="ah-slide-title">一、坐标系建立与轮廓预处理</h3>
            <div className="ah-two-col">
              <div className="ah-bullets">
                <ul>
                  <li>
                    <Target className="ah-li-icon" size={16} strokeWidth={2.25} aria-hidden />
                    <strong>绝对坐标系锚定</strong>
                    原点 (0,0) 严格绑定于接触线中点。径向距离 r 不是图像横坐标，而是到对称轴的垂距。确保铺展直径 D = 2r_max。
                  </li>
                  <li>
                    <Activity className="ah-li-icon" size={16} strokeWidth={2.25} aria-hidden />
                    <strong>消除海岸线悖论 (Coastline Paradox)</strong>
                    相机的方形像素会导致原始轮廓呈曼哈顿阶梯状，导致表面积被系统性高估 20%–40%。
                  </li>
                  <li>
                    <Filter className="ah-li-icon" size={16} strokeWidth={2.25} aria-hidden />
                    <strong>Savitzky–Golay 平滑滤波</strong>
                    利用多项式局部拟合，消除像素锯齿，同时保留波峰谷底拓扑特征，为积分提供平滑流形。
                  </li>
                </ul>
              </div>
              <div>
                <div className="ah-formula-box">
                  <h4>坐标系转换公式</h4>
                  <MathBlock html={MATH_COORD_R} />
                  <MathBlock html={MATH_COORD_Z} />
                </div>
              </div>
            </div>
          </section>

          <section className="ah-slide">
            <h3 className="ah-slide-title">二、拓扑积分：体积、质心与表面能</h3>
            <div className="ah-two-col">
              <div>
                <p className="ah-p">
                  为解决悬垂、颈缩等非单值拓扑，我们摒弃切片法，采用<strong>散度定理 (Divergence Theorem)</strong>
                  将三维体积分降维至二维轮廓线积分。
                </p>
                <MathBlock html={MATH_VOL} />
                <MathBlock html={MATH_ZCM} />
              </div>
              <div className="ah-bullets">
                <ul>
                  <li>
                    <CheckCheck className="ah-li-icon" size={16} strokeWidth={2.25} aria-hidden />
                    <strong>体积守恒底线校验</strong>
                    基于水不可压缩性，全程监控积分体积 V(t)。偏差限制在 ±5% 内，确保图像算法的稳健性。
                  </li>
                  <li>
                    <Sparkles className="ah-li-icon" size={16} strokeWidth={2.25} aria-hidden />
                    <strong>表面能与空泡动力学</strong>
                    由于背光摄像的局限，部分空泡界面积被遮挡。但在 1000 cSt 下空泡更大，这进一步强化了高粘度系统具有更高势能的核心结论（下限防御）。
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section className="ah-slide">
            <h3 className="ah-slide-title">三、动能估算：仿射形变假设</h3>
            <div className="ah-two-col">
              <div className="ah-bullets">
                <ul>
                  <li>
                    <Weight className="ah-li-icon" size={16} strokeWidth={2.25} aria-hidden />
                    <strong>恒定质量原则</strong>
                    全局绑定初始刚性质量 M，拒绝使用带噪点的积分体积算质量，防止虚拟动能波动。
                  </li>
                  <li>
                    <GitBranch className="ah-li-icon" size={16} strokeWidth={2.25} aria-hidden />
                    <strong>速度场解耦</strong>
                    拆分为纵向的质心平移速度 (V_cm) 与横向的边缘铺展速度 (V_spread)。
                  </li>
                  <li>
                    <Shield className="ah-li-icon" size={16} strokeWidth={2.25} aria-hidden />
                    <strong>可防御的合成公式</strong>
                    假设内部向外的径向速度呈线性分布，体积分后推导出 1/2 的几何修正系数，避免高估体相动能。
                  </li>
                </ul>
              </div>
              <div>
                <div className="ah-formula-box">
                  <h4>三维动能合成公式</h4>
                  <MathBlock html={MATH_EK_AFFINE} />
                </div>
              </div>
            </div>
          </section>

          <section className="ah-slide">
            <h3 className="ah-slide-title">四、耗散动力学：能量黑洞的推导</h3>
            <div className="ah-two-col">
              <div>
                <div className="ah-formula-box">
                  <h4 style={{ color: 'var(--ah-accent)' }}>宏观能量守恒与耗散功</h4>
                  <MathBlock html={MATH_WDISS} />
                  <h4 style={{ color: 'var(--ah-accent)', marginTop: 10 }}>瞬态耗散功率</h4>
                  <MathBlock html={MATH_PHI} />
                </div>
              </div>
              <div className="ah-bullets">
                <ul>
                  <li>
                    <LineChart className="ah-li-icon" size={16} strokeWidth={2.25} aria-hidden />
                    <strong>二阶中心差分防噪点放大</strong>
                    求导是高频噪音的放大器。严禁使用向后差分，全线采用二阶中心差分平滑提取 Φ(t) 曲线，准确捕捉耗散峰值。
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section className="ah-slide">
            <h3 className="ah-slide-title">五、算法与计算重构全流程图谱</h3>
            <div className="ah-flow-grid">
              <div className="ah-flow-node ah-node-1">
                <div className="ah-flow-icon">
                  <Camera size={22} strokeWidth={2} />
                </div>
                <h4>1. 图像预处理</h4>
                <p>
                  提取原始边缘点 (u,v)
                  <br />
                  原点绑定接触线中点
                  <br />
                  S–G 滤波消除海岸线悖论
                </p>
              </div>
              <div className="ah-flow-arrow ah-arrow-1">
                <ArrowRight size={20} />
              </div>
              <div className="ah-flow-node ah-node-2">
                <div className="ah-flow-icon">
                  <Box size={22} strokeWidth={2} />
                </div>
                <h4>2. 拓扑降维积分</h4>
                <p>
                  散度定理求体积与质心
                  <br />
                  Pappus 定理求自由表面积
                  <br />
                  执行不可压缩体积守恒校验
                </p>
              </div>
              <div className="ah-flow-arrow ah-arrow-2">
                <ArrowRight size={20} />
              </div>
              <div className="ah-flow-node ah-node-3">
                <div className="ah-flow-icon">
                  <Gauge size={22} strokeWidth={2} />
                </div>
                <h4>3. 运动学提取</h4>
                <p>
                  绑定恒定初始刚性质量 M
                  <br />
                  求导得垂直平移速度 V_cm
                  <br />
                  提取边界极限铺展速度
                </p>
              </div>

              <div className="ah-flow-arrow ah-arrow-3">
                <ArrowDown size={20} />
              </div>

              <div className="ah-flow-node ah-node-4">
                <div className="ah-flow-icon">
                  <Zap size={22} strokeWidth={2} />
                </div>
                <h4>4. 能量演化重构</h4>
                <p>
                  引入仿射形变修正径向动能
                  <br />
                  自洽合成全场总动能 E_k
                  <br />
                  三相张力重构瞬态表面能
                </p>
              </div>
              <div className="ah-flow-arrow ah-arrow-4">
                <ArrowLeft size={20} />
              </div>
              <div className="ah-flow-node ah-node-5 ah-highlight">
                <div className="ah-flow-icon">
                  <Flame size={22} strokeWidth={2} />
                </div>
                <h4>5. 耗散动力学推导</h4>
                <p>
                  孤立系统计算累积耗散功
                  <br />
                  中心差分平滑防爆求导
                  <br />
                  精确提取瞬态耗散功率 Φ(t)
                </p>
              </div>
            </div>
          </section>
        </div>
      </aside>
    </>
  )
}
