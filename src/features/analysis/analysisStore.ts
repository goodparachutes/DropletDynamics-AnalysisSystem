import type { AnalysisPoint, AutoCalibrationResult, CalibrationPoint, InteractionMode } from '../../types/analysis'

export interface AnalysisState {
  mode: InteractionMode
  isPlaying: boolean
  isAnalyzing: boolean
  selectedIdx: number
  draggingHandle: 'left' | 'right' | null
  hoverPos: CalibrationPoint | null
  calibrationPoints: CalibrationPoint[]
  autoCalibResult: AutoCalibrationResult | null
  analysisData: AnalysisPoint[]
}

export type AnalysisAction =
  | { type: 'setMode'; mode: InteractionMode }
  | { type: 'setPlaying'; isPlaying: boolean }
  | { type: 'setAnalyzing'; isAnalyzing: boolean }
  | { type: 'setSelectedIdx'; selectedIdx: number }
  | { type: 'setDraggingHandle'; draggingHandle: 'left' | 'right' | null }
  | { type: 'setHoverPos'; hoverPos: CalibrationPoint | null }
  | { type: 'setCalibrationPoints'; calibrationPoints: CalibrationPoint[] }
  | { type: 'setAutoCalibResult'; autoCalibResult: AutoCalibrationResult | null }
  | { type: 'setAnalysisData'; analysisData: AnalysisPoint[] }
  | { type: 'appendAnalysisPoint'; point: AnalysisPoint }
  | { type: 'resetAnalysis' }
  /** 多视频切换：整体替换 reducer 状态（须 structuredClone 后的副本） */
  | { type: 'hydrate'; state: AnalysisState }

export const initialAnalysisState: AnalysisState = {
  mode: 'idle',
  isPlaying: false,
  isAnalyzing: false,
  selectedIdx: -1,
  draggingHandle: null,
  hoverPos: null,
  calibrationPoints: [],
  autoCalibResult: null,
  analysisData: [],
}

export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case 'setMode':
      return { ...state, mode: action.mode }
    case 'setPlaying':
      return { ...state, isPlaying: action.isPlaying }
    case 'setAnalyzing':
      return { ...state, isAnalyzing: action.isAnalyzing }
    case 'setSelectedIdx':
      return { ...state, selectedIdx: action.selectedIdx }
    case 'setDraggingHandle':
      return { ...state, draggingHandle: action.draggingHandle }
    case 'setHoverPos':
      return { ...state, hoverPos: action.hoverPos }
    case 'setCalibrationPoints':
      return { ...state, calibrationPoints: action.calibrationPoints }
    case 'setAutoCalibResult':
      return { ...state, autoCalibResult: action.autoCalibResult }
    case 'setAnalysisData':
      return { ...state, analysisData: action.analysisData }
    case 'appendAnalysisPoint':
      if (state.analysisData.some((p) => p.time === action.point.time)) return state
      return { ...state, analysisData: [...state.analysisData, action.point] }
    case 'resetAnalysis':
      return { ...state, analysisData: [], selectedIdx: -1, autoCalibResult: null }
    case 'hydrate':
      return { ...action.state }
    default:
      return state
  }
}
