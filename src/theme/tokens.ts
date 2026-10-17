export const colors = {
  bg0: '#101114',
  bg1: '#17181c',
  bg2: '#1e1f24',
  bg3: '#26272e',
  bg4: '#2f3038',
  border: '#33343c',
  borderStrong: '#45464f',
  text: '#e6e6ea',
  textMuted: '#9a9ba4',
  textDim: '#6c6d76',
  accent: '#4f8cff',
  accentSoft: 'rgba(79,140,255,0.18)',
  warning: '#f5a623',
  danger: '#e5484d',
  success: '#3fb950',
  pivot: '#ff5c8a',
  attachment: '#5ce0a8',
  attachmentLabel: '#9af5cf',
  selection: '#4f8cff',
  hover: 'rgba(255,255,255,0.08)',
  link: '#f0c674',
  grid: 'rgba(255,255,255,0.06)',
  gridMajor: 'rgba(255,255,255,0.12)',
  axis: 'rgba(255,255,255,0.28)',
  canvas: '#1e1f24',
  checkerA: '#2a2b31',
  checkerB: '#22232a',
  keyframe: '#f0c674',
  playhead: '#ff5c5c',
} as const;

export const spacing = { xs: 2, sm: 4, md: 8, lg: 12, xl: 16 } as const;

export const font = {
  xs: 10,
  sm: 11,
  md: 12,
  lg: 13,
  xl: 15,
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;

export const sizes = {
  menuBar: 28,
  toolBar: 34,
  statusBar: 22,
  tabBar: 28,
  panelHeader: 24,
  explorerWidth: 220,
  rightWidth: 280,
  timelineHeight: 220,
  touchTarget: 36,
} as const;
