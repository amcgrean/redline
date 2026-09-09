/** Public surface of the editor store. Implementation lives in `store/`. */

export { actions, useEditor, useEditorStore, MIN_ZOOM, MAX_ZOOM } from './store/editor';
export type {
  Tool,
  ZoomMode,
  LayoutMode,
  EditorUiState,
  DocumentTab,
  PanelTab,
  ScaleScope,
} from './store/editor';
export { getSession, listSessions, History } from './store/session';
export type { Command } from './store/commands';
