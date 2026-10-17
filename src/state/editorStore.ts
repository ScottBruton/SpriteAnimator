import { create } from 'zustand';
import type { Direction } from '@elemental/asset-schema';
import type { HandleMode } from '@/engine/picking';

export type Workspace = 'rigging' | 'animate' | 'assembly';
export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'pivot' | 'attachment' | 'link' | 'pan' | 'zoom';
export type { HandleMode };

export interface ViewState {
  zoom: number;
  /** Screen position of the world origin (canvas pixels). */
  panX: number;
  panY: number;
}

export interface SnapIndicator {
  worldX: number;
  worldY: number;
  parentInstanceId: string;
  /** Omit when snapping onto the parent's pivot (node origin). */
  attachmentId?: string;
}

interface EditorState {
  workspace: Workspace;
  tool: Tool;
  /** Which selection-box handles are active (default scale). */
  handleMode: HandleMode;
  selectedIds: string[];
  hoveredId: string | null;
  view: ViewState;
  showGrid: boolean;
  showRulers: boolean;
  showPivots: boolean;
  showAttachments: boolean;
  showJointLines: boolean;
  onionSkin: boolean;
  snapIndicator: SnapIndicator | null;
  /** Live world cursor position for the status bar. */
  cursorWorld: { x: number; y: number } | null;
  fps: number;

  // Animation
  activeActionId: string | null;
  playhead: number;
  playing: boolean;
  playbackSpeed: number;
  autoKey: boolean;
  loopPreview: boolean;

  // Direction / assembly
  direction: Direction;

  // Panels
  explorerOpen: boolean;
  rightOpen: boolean;
  timelineOpen: boolean;
  explorerWidth: number;
  rightWidth: number;
  timelineHeight: number;

  // Dialogs
  spriteEditorAssetId: string | null;
  dialog: null | 'projects' | 'export' | 'settings' | 'about' | 'importSheet' | 'newProject' | 'saveAs';
  status: { message: string; kind: 'info' | 'error' | 'success'; at: number } | null;
  /** Asset being dragged from the library (window coordinates). */
  dragAsset: { assetId: string; x: number; y: number } | null;
  /** Keyframes selected in the timeline. */
  selectedKeys: { targetId: string; property: string; time: number }[];
  keyClipboard: { targetId: string; property: string; relTime: number; value: unknown; interpolation: string }[];

  setWorkspace: (w: Workspace) => void;
  setDragAsset: (d: { assetId: string; x: number; y: number } | null) => void;
  setSelectedKeys: (k: { targetId: string; property: string; time: number }[]) => void;
  setKeyClipboard: (k: EditorState['keyClipboard']) => void;
  setTool: (t: Tool) => void;
  setHandleMode: (m: HandleMode) => void;
  select: (ids: string[], opts?: { toggle?: boolean }) => void;
  setHovered: (id: string | null) => void;
  setView: (v: Partial<ViewState>) => void;
  zoomAt: (factor: number, screenX: number, screenY: number) => void;
  toggle: (key: 'showGrid' | 'showRulers' | 'showPivots' | 'showAttachments' | 'showJointLines' | 'onionSkin' | 'autoKey' | 'loopPreview' | 'explorerOpen' | 'rightOpen' | 'timelineOpen') => void;
  setSnapIndicator: (s: SnapIndicator | null) => void;
  setCursorWorld: (p: { x: number; y: number } | null) => void;
  setFps: (fps: number) => void;
  setActiveAction: (id: string | null) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setPlaybackSpeed: (s: number) => void;
  setDirection: (d: Direction) => void;
  setPanelSize: (key: 'explorerWidth' | 'rightWidth' | 'timelineHeight', v: number) => void;
  openSpriteEditor: (assetId: string | null) => void;
  openDialog: (d: EditorState['dialog']) => void;
  setStatus: (message: string, kind?: 'info' | 'error' | 'success') => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  workspace: 'rigging',
  tool: 'select',
  handleMode: 'scale',
  selectedIds: [],
  hoveredId: null,
  view: { zoom: 1, panX: 0, panY: 0 },
  showGrid: true,
  showRulers: true,
  showPivots: true,
  showAttachments: true,
  showJointLines: true,
  onionSkin: false,
  snapIndicator: null,
  cursorWorld: null,
  fps: 0,
  activeActionId: null,
  playhead: 0,
  playing: false,
  playbackSpeed: 1,
  autoKey: false,
  loopPreview: true,
  direction: 'S',
  explorerOpen: true,
  rightOpen: true,
  timelineOpen: true,
  explorerWidth: 220,
  rightWidth: 290,
  timelineHeight: 220,
  spriteEditorAssetId: null,
  dialog: null,
  status: null,
  dragAsset: null,
  selectedKeys: [],
  keyClipboard: [],

  setWorkspace: (workspace) => set({ workspace, playing: false }),
  setDragAsset: (dragAsset) => set({ dragAsset }),
  setSelectedKeys: (selectedKeys) => set({ selectedKeys }),
  setKeyClipboard: (keyClipboard) => set({ keyClipboard }),
  setTool: (tool) => set({ tool }),
  setHandleMode: (handleMode) => set({ handleMode }),
  select: (ids, opts) => {
    if (opts?.toggle) {
      const cur = new Set(get().selectedIds);
      for (const id of ids) {
        if (cur.has(id)) cur.delete(id);
        else cur.add(id);
      }
      set({ selectedIds: [...cur] });
    } else {
      set({ selectedIds: ids });
    }
  },
  setHovered: (hoveredId) => set({ hoveredId }),
  setView: (v) => set({ view: { ...get().view, ...v } }),
  zoomAt: (factor, sx, sy) => {
    const { view } = get();
    const newZoom = Math.min(64, Math.max(0.05, view.zoom * factor));
    const k = newZoom / view.zoom;
    set({ view: { zoom: newZoom, panX: sx - (sx - view.panX) * k, panY: sy - (sy - view.panY) * k } });
  },
  toggle: (key) => set({ [key]: !get()[key] } as Partial<EditorState>),
  setSnapIndicator: (snapIndicator) => set({ snapIndicator }),
  setCursorWorld: (cursorWorld) => set({ cursorWorld }),
  setFps: (fps) => set({ fps }),
  setActiveAction: (activeActionId) => set({ activeActionId, playhead: 0, playing: false }),
  setPlayhead: (playhead) => set({ playhead }),
  setPlaying: (playing) => set({ playing }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  setDirection: (direction) => set({ direction }),
  setPanelSize: (key, v) => set({ [key]: v } as Partial<EditorState>),
  openSpriteEditor: (spriteEditorAssetId) => set({ spriteEditorAssetId }),
  openDialog: (dialog) => set({ dialog }),
  setStatus: (message, kind = 'info') => set({ status: { message, kind, at: Date.now() } }),
}));
