import type { ContactAngleMethod } from '../../features/analysis/contactAngle'

interface ImageSettingsPanelProps {
  threshold: number
  dropletIsBright: boolean
  algorithmMode: 'legacy' | 'neckGradient'
  contactAngleMethod: ContactAngleMethod
  fitPrecision: number
  onThresholdChange: (value: number) => void
  onDropletIsBrightChange: (value: boolean) => void
  onAlgorithmModeChange: (mode: 'legacy' | 'neckGradient') => void
  onContactAngleMethodChange: (mode: ContactAngleMethod) => void
  onFitPrecisionChange: (value: number) => void
}

export function ImageSettingsPanel({
  threshold,
  dropletIsBright,
  algorithmMode,
  contactAngleMethod,
  fitPrecision,
  onThresholdChange,
  onDropletIsBrightChange,
  onAlgorithmModeChange,
  onContactAngleMethodChange,
  onFitPrecisionChange,
}: ImageSettingsPanelProps) {
  return (
    <>
      <div className="algo-switch">
        <button
          type="button"
          className={`algo-btn ${algorithmMode === 'neckGradient' ? 'active' : ''}`}
          onClick={() => onAlgorithmModeChange('neckGradient')}
        >
          Neck-Gradient
        </button>
        <button
          type="button"
          className={`algo-btn ${algorithmMode === 'legacy' ? 'active' : ''}`}
          onClick={() => onAlgorithmModeChange('legacy')}
        >
          Legacy
        </button>
      </div>
      <div className="algo-switch">
        <button
          type="button"
          className={`algo-btn ${contactAngleMethod === 'linearRegression' ? 'active' : ''}`}
          onClick={() => onContactAngleMethodChange('linearRegression')}
        >
          θ 直线回归
        </button>
        <button
          type="button"
          className={`algo-btn ${contactAngleMethod === 'spreadSpline' ? 'active' : ''}`}
          onClick={() => onContactAngleMethodChange('spreadSpline')}
        >
          θ 青样条切线
        </button>
      </div>
      <p className="panel-hint">
        直线回归：基准线一侧多行轮廓点做 x(y) 最小二乘；下方「拟合精度」调高会加大取样深度并增加参与点数（仍优先最靠基准线的行）。青样条：竖直带内轮廓+PCHIP。切换 θ 算法或改精度后请重新运行分析。
      </p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={dropletIsBright}
          onChange={(e) => onDropletIsBrightChange(e.target.checked)}
        />
        <span>液滴偏亮（深色背景）</span>
      </label>
      <p className="panel-hint">
        默认认为液滴比背景暗（灰度小于阈值即为液滴）。若液滴更亮、基底更暗，请勾选此项；右下角预览应与肉眼轮廓一致。
      </p>
      <label>
        二值化阈值: {threshold}
        <input
          type="range"
          min={0}
          max={255}
          value={threshold}
          onChange={(e) => onThresholdChange(+e.target.value)}
        />
      </label>
      <label>
        拟合精度（直线：取样深度+点数；青样条/铺展：竖直带深度）: {fitPrecision}
        <input
          type="range"
          min={0}
          max={100}
          value={fitPrecision}
          onChange={(e) => onFitPrecisionChange(+e.target.value)}
        />
      </label>
    </>
  )
}
