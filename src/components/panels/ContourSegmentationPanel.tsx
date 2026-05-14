import type { ContourSegmentationMode } from '../../features/analysis/dropletContour'

interface ContourSegmentationPanelProps {
  mode: ContourSegmentationMode
  onModeChange: (mode: ContourSegmentationMode) => void
  /** 背景灰度尺寸与当前视频帧一致，差分与右上角预览可用 */
  hasBackground: boolean
  /** 已存有背景但与当前分辨率不一致（例如换过视频） */
  backgroundResolutionMismatch?: boolean
  hasVideo: boolean
  surfaceYSet: boolean
  diffThreshold: number
  onDiffThresholdChange: (v: number) => void
  morphCloseIterations: number
  onMorphCloseChange: (v: number) => void
  onCaptureBackgroundFromCanvas: () => void
  onSyntheticBackgroundFromCanvas: () => void
  onClearBackground: () => void
  /** 全序列共用的背景杂质涂抹（圆个数）；修改后需重新分析 */
  globalSuppressStrokeCount: number
  canUseGlobalSuppress: boolean
  onOpenGlobalSuppress: () => void
  onClearGlobalSuppress: () => void
}

export function ContourSegmentationPanel({
  mode,
  onModeChange,
  hasBackground,
  backgroundResolutionMismatch = false,
  hasVideo,
  surfaceYSet,
  diffThreshold,
  onDiffThresholdChange,
  morphCloseIterations,
  onMorphCloseChange,
  onCaptureBackgroundFromCanvas,
  onSyntheticBackgroundFromCanvas,
  onClearBackground,
  globalSuppressStrokeCount,
  canUseGlobalSuppress,
  onOpenGlobalSuppress,
  onClearGlobalSuppress,
}: ContourSegmentationPanelProps) {
  const disabled = !hasVideo || !surfaceYSet
  /** 无对齐背景时主画布/小窗仍按亮度二值渲染，差分阈值不改变像素（见 App updateProcessedPreview 的 useAbsDiff） */
  const diffThrInactive = mode === 'absDiff' && !hasBackground
  const diffSliderDisabled = disabled || mode !== 'absDiff' || !hasBackground
  return (
    <>
      <p className="panel-hint">
        静态黑点在亮度二值里易被误认为液滴。背光 Shadowgraphy 的透镜/TIR 常在滴内形成二值「高光空洞」，算法在每次二值化后自动做<strong>背景反向泛洪</strong>（四边泛洪真实背景再反转），得到实心掩码，Moore 只跟最外层液–气边界；闭运算用于残余碎斑。选「背景差分」后须先<strong>采集背景</strong>：右上角浮动小窗会切换为<strong>差分二值</strong>
        （|ΔI| 大于下方滑块则显示为黑），与轮廓提取一致；仅切换模式而未采集背景时小窗仍为亮度二值。
      </p>
      <div className="algo-switch">
        <button
          type="button"
          className={`algo-btn ${mode === 'luminance' ? 'active' : ''}`}
          disabled={disabled}
          onClick={() => onModeChange('luminance')}
        >
          亮度阈值
        </button>
        <button
          type="button"
          className={`algo-btn ${mode === 'absDiff' ? 'active' : ''}`}
          disabled={disabled}
          onClick={() => onModeChange('absDiff')}
        >
          背景差分
        </button>
      </div>
      {mode === 'absDiff' && backgroundResolutionMismatch && (
        <p className="panel-hint" style={{ color: '#fb923c' }}>
          已保存的背景分辨率与当前视频不一致，请重新「采集背景」或「合成背景」。
        </p>
      )}
      {mode === 'absDiff' && (
        <>
          <p className="panel-hint" style={{ color: hasBackground ? '#6ee7b7' : '#fb923c' }}>
            {hasBackground
              ? '参考背景已对齐当前分辨率：Moore 与右上角小窗均使用差分二值（可调 |ΔI| 阈值）。'
              : '尚未加载可用背景：请先采集空场景或与液滴帧同尺寸的参考帧，或使用「合成背景」。'}
          </p>
          <p className="panel-hint">
            「合成背景」会把<strong>当前帧</strong>检测到的液滴区域用邻近真实背景灰度填平，得到静态参考图（不是保留液滴形状）；其它帧与它对差分才能突出运动液滴。若只有含滴帧，优先用合成；有空场景帧则用采集更干净。
          </p>
        </>
      )}
      <div className="contour-seg-actions">
        {mode === 'absDiff' && (
          <>
            <button type="button" className="ghost-btn wide" disabled={disabled} onClick={onCaptureBackgroundFromCanvas}>
              采集背景（当前帧）
            </button>
            <button
              type="button"
              className="ghost-btn wide"
              disabled={disabled}
              onClick={onSyntheticBackgroundFromCanvas}
            >
              合成背景（填平液滴区）
            </button>
            <button type="button" className="ghost-btn wide" disabled={!hasBackground} onClick={onClearBackground}>
              清除背景
            </button>
          </>
        )}
        <button
          type="button"
          className="ghost-btn wide"
          disabled={!canUseGlobalSuppress}
          onClick={onOpenGlobalSuppress}
        >
          全局背景涂抹…
        </button>
        <button
          type="button"
          className="ghost-btn wide"
          disabled={!canUseGlobalSuppress || globalSuppressStrokeCount === 0}
          onClick={onClearGlobalSuppress}
        >
          清除全局涂抹（{globalSuppressStrokeCount}）
        </button>
      </div>
      <label>
        差分阈值 |ΔI| &gt; {diffThreshold}
        <input
          type="range"
          min={4}
          max={80}
          step={1}
          value={diffThreshold}
          disabled={diffSliderDisabled}
          onChange={(e) => onDiffThresholdChange(+e.target.value)}
        />
        {diffThrInactive && (
          <span className="panel-field-sub">
            请先「采集背景」或「合成背景」（与当前视频同分辨率）；否则预览仍为亮度二值，拖动此滑块<strong>不会</strong>改变画面。
          </span>
        )}
      </label>
      <label>
        形态学闭运算次数（3×3）：{morphCloseIterations}
        <input
          type="range"
          min={0}
          max={8}
          step={1}
          value={morphCloseIterations}
          disabled={disabled}
          onChange={(e) => onMorphCloseChange(+e.target.value)}
        />
      </label>
      <p className="panel-hint">
        修改上述选项后需<strong>重新运行分析</strong>才作用于全序列（图表里的 β、直径、Moore 轮廓等仍是上次分析结果）；「全局背景涂抹」在固定画布坐标上压制静止杂质，对所有帧的二值掩码生效，保存后也请<strong>重新分析</strong>。若某帧在掩码橡皮擦里写过<strong>单帧差分阈值覆盖</strong>，重新分析时该帧仍以覆盖值为准，全局差分滑块改不动它——可用「外轮廓序列」里复位该帧轮廓默认清除覆盖。
      </p>
      <p className="panel-hint">
        单帧局部修补仍用下方「外轮廓序列」里的掩码橡皮，仅重算该帧轮廓。
      </p>
    </>
  )
}
