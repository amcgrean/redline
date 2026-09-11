/** Every drawing tool with its accessible label (the hotkey in brackets) and hint. */

import type { Tool } from './store';

export const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select (V)', hint: 'Click a markup to select it, then drag to move.' },
  {
    id: 'pan',
    label: 'Pan (H)',
    hint: 'Drag to move the view. Hold Space from any tool, or drag with the middle button. Scroll wheel zooms.',
  },
  {
    id: 'text',
    label: 'Select Text',
    hint: 'Drag across page text to select it; Ctrl+C copies.',
  },
  {
    id: 'calibrate',
    label: 'Calibrate (X)',
    hint: 'Click two points a known distance apart, then type the distance.',
  },
  { id: 'length', label: 'Length (M)', hint: 'Click the two ends of the run.' },
  {
    id: 'polylength',
    label: 'Polylength (Shift+M)',
    hint: 'Click each turn of the run; double-click or press Enter to finish. Esc cancels.',
  },
  {
    id: 'area',
    label: 'Area (A)',
    hint: 'Click each corner; click the first corner again, double-click, or press Enter to finish. Esc cancels.',
  },
  {
    id: 'perimeter',
    label: 'Perimeter (Shift+A)',
    hint: 'Click each corner; click the first corner again, double-click, or press Enter to close the loop.',
  },
  {
    id: 'rectarea',
    label: 'Rect Area',
    hint: 'Click two opposite corners of the rectangle.',
  },
  {
    id: 'count',
    label: 'Count (C)',
    hint: 'Click each item to count it. Re-select the tool to start a new group.',
  },
  { id: 'rectangle', label: 'Rect (R)', hint: 'Press and drag a rectangle.' },
  { id: 'ellipse', label: 'Ellipse (E)', hint: 'Press and drag an ellipse.' },
  { id: 'line', label: 'Line (L)', hint: 'Click the two ends.' },
  { id: 'arrow', label: 'Arrow (Shift+L)', hint: 'Click the tail, then the head.' },
  {
    id: 'polygon',
    label: 'Polygon (G)',
    hint: 'Click each corner; click the first corner again, double-click, or press Enter to finish.',
  },
  { id: 'pen', label: 'Pen (P)', hint: 'Press and drag to draw freehand.' },
  {
    id: 'cloud',
    label: 'Cloud (Shift+G)',
    hint: 'Click each corner; click the first corner again, double-click, or press Enter to finish.',
  },
  {
    id: 'highlighter',
    label: 'Highlighter (Shift+H)',
    hint: 'Press and drag to highlight; it multiplies over the drawing.',
  },
  {
    id: 'textbox',
    label: 'Text Box (T)',
    hint: 'Drag a box (or click for a default one), type, then Ctrl+Enter or click away.',
  },
  {
    id: 'callout',
    label: 'Callout (K)',
    hint: 'Click what to point at, then drag the box and type.',
  },
  {
    id: 'stamp',
    label: 'Stamp (S)',
    hint: 'Click where the top-left of the stamp goes. Pick a stamp in the Tools panel.',
  },
  { id: 'note', label: 'Note (N)', hint: 'Click to place a sticky note, type, press Enter.' },
];
