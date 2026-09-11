/**
 * Konva overlay for one page. Geometry comes from the `Markup` model in PDF user space
 * and is converted to CSS pixels through pdf.js's page viewport (which folds in /Rotate,
 * the CropBox origin and the y-flip), so screen pixels never leave this file.
 */

import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Group, Line, Rect, Ellipse, Text, Image as KImage } from 'react-konva';
import { cloudOutline, cloudRadius, countGroupOf } from '@redline/pdf-core';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Markup, Point, Rect as PdfRect, RGB } from '@redline/pdf-core';
import {
  geometryBounds,
  formatLength,
  formatArea,
  polylineLength,
  polygonArea,
  worldUnitsPerPoint,
} from '@redline/pdf-core';
import type { PageViewport } from './pdfjs';
import { actions, getSession, useEditor, useEditorStore } from './store';
import { renderApBitmap, type ApBitmap } from './apBitmap';
import { CalibrateDialog } from './CalibrateDialog';
import { TextEditor } from './TextEditor';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { constrainAngle, constrainSquare, nearestCandidate, snapCandidates } from './snap';
import type { SnapCandidate } from './snap';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Props {
  pageIndex: number;
  viewport: PageViewport;
  visible: Box;
}

function css(color: RGB | undefined, alpha = 1): string {
  if (!color) return 'transparent';
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgba(${c(color.r)}, ${c(color.g)}, ${c(color.b)}, ${alpha})`;
}

const SELECT_COLOR = '#0288d1';
const HANDLE = 8;
const DRAFT_COLOR = '#d32f2f';

export function MarkupLayer({ pageIndex, viewport, visible }: Props) {
  const { doc, tool, selectedIds, version, spacePan, snapEnabled } = useEditor();
  const panning = tool === 'pan' || spacePan;
  const [draft, setDraftState] = useState<Point[]>([]);
  // Mirror of `draft` for handlers that fire in the same tick as a state update (Konva
  // raises `dblclick` after the second `click`, with the closure still holding the old draft).
  const draftRef = useRef<Point[]>([]);
  const setDraft = (points: Point[]) => {
    draftRef.current = points;
    setDraftState(points);
  };
  const [hover, setHover] = useState<Point | undefined>();
  /** Callout: the first click sets the arrow target; the drag then places the box. */
  const [calloutTarget, setCalloutTarget] = useState<Point | undefined>();
  /** Rubber-band selection in page pixels (layer coordinates). */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number }>();
  const marqueeRef = useRef<typeof marquee>(undefined);
  const justMarqueed = useRef(false);
  const [calibrating, setCalibrating] = useState<[Point, Point] | undefined>();
  const [menu, setMenu] = useState<
    { x: number; y: number; markupId?: string; at?: Point } | undefined
  >();
  /** The snap point the pointer is currently on, for the indicator. */
  const [snapHit, setSnapHit] = useState<Point | undefined>();
  const snapHitRef = useRef<Point | undefined>(undefined);
  void version; // re-render on every mutation

  const toPx = (p: Point): [number, number] => {
    const [x, y] = viewport.convertToViewportPoint(p.x, p.y);
    return [x, y];
  };
  const toPdf = (x: number, y: number): Point => {
    const [px, py] = viewport.convertToPdfPoint(x, y);
    return { x: px, y: py };
  };
  const pointsPx = (points: readonly Point[]): number[] => points.flatMap(toPx);

  const isPolyTool =
    tool === 'area' ||
    tool === 'polylength' ||
    tool === 'perimeter' ||
    tool === 'polygon' ||
    tool === 'cloud';
  const closesDraft =
    tool === 'area' ||
    tool === 'perimeter' ||
    tool === 'rectarea' ||
    tool === 'polygon' ||
    tool === 'cloud';
  /** Press-drag-release tools. */
  const isDragTool =
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'pen' ||
    tool === 'highlighter' ||
    tool === 'textbox' ||
    (tool === 'callout' && calloutTarget !== undefined);
  const dragDraft = useRef<Point[] | undefined>(undefined);
  /** Pending text entry: where the box goes, what it is, and any existing markup being edited. */
  const [editor, setEditor] = useState<
    | { kind: 'textbox'; rect: PdfRect }
    | { kind: 'callout'; rect: PdfRect; target: Point }
    | { kind: 'note'; at: Point }
    | { kind: 'edit'; id: string; rect: PdfRect; initial: string; singleLine: boolean }
    | undefined
  >(undefined);

  // Escape cancels a draft; Enter finishes a multi-vertex tool.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDraft([]);
        setCalibrating(undefined);
      }
      if (event.key === 'Enter' && isPolyTool) finishPoly(draftRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    setDraft([]);
    setCalloutTarget(undefined);
    setEditor(undefined);
    snapHitRef.current = undefined;
    setSnapHit(undefined);
  }, [tool]);

  const rawPointerPdf = (event: KonvaEventObject<MouseEvent>): Point | undefined => {
    const stage = event.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return undefined;
    return toPdf(pos.x + visible.left, pos.y + visible.top);
  };

  /** Tools whose points snap and constrain. Freehand, counts and notes place as clicked. */
  const snappingTool =
    tool !== 'select' &&
    tool !== 'text' &&
    tool !== 'pan' &&
    tool !== 'count' &&
    tool !== 'note' &&
    tool !== 'stamp' &&
    tool !== 'pen' &&
    tool !== 'highlighter';

  /** Snap targets on this page, rebuilt when the document changes. */
  const candidates = (excludeId?: string): SnapCandidate[] => {
    // Computed on demand from the live document (a page has tens of markups, not thousands),
    // so a handler closure from an earlier render can never see a stale list.
    if (!doc || !snapEnabled) return [];
    return snapCandidates(
      doc.markups.filter((m) => m.pageIndex === pageIndex),
      excludeId,
    );
  };
  /** 10 screen pixels in user space. */
  const snapTolerance = (): number => {
    const o = toPdf(0, 0);
    const q = toPdf(10, 0);
    return Math.hypot(q.x - o.x, q.y - o.y);
  };
  const showSnapHit = (hit: Point | undefined) => {
    const was = snapHitRef.current;
    if (was === hit || (was && hit && was.x === hit.x && was.y === hit.y)) return;
    snapHitRef.current = hit;
    setSnapHit(hit);
  };

  /** Snap (unless Alt) then constrain (Shift) a pointer position against the draft in progress. */
  const adjust = (raw: Point, evt: MouseEvent): Point => {
    if (!snappingTool) return raw;
    let p = raw;
    let hit: Point | undefined;
    if (!evt.altKey) {
      const near = nearestCandidate(raw, candidates(), snapTolerance());
      if (near) {
        p = { x: near.point.x, y: near.point.y }; // a copy: never share a vertex object
        hit = p;
      }
    }
    const inDrag = dragDraft.current;
    const anchor = inDrag ? inDrag[0] : draftRef.current[draftRef.current.length - 1];
    if (evt.shiftKey && anchor) {
      p = inDrag ? constrainSquare(anchor, p) : constrainAngle(anchor, p);
      if (hit && (hit.x !== p.x || hit.y !== p.y)) hit = undefined;
    }
    showSnapHit(hit);
    return p;
  };

  /** Pointer in user space, snapped and constrained for drawing tools. */
  const pointerPdf = (event: KonvaEventObject<MouseEvent>): Point | undefined => {
    const raw = rawPointerPdf(event);
    return raw ? adjust(raw, event.evt) : raw;
  };

  /** Vertex-handle drags snap to other markups (never to the markup being edited). */
  const snapVertex = (id: string, p: Point, evt: MouseEvent): Point => {
    if (!snapEnabled || evt.altKey) return p;
    const near = nearestCandidate(p, candidates(id), snapTolerance());
    return near ? { x: near.point.x, y: near.point.y } : p;
  };

  /** Complete the multi-vertex tool in progress, if it has enough vertices. */
  const finishPoly = (points: Point[]) => {
    const minimum = tool === 'polylength' ? 2 : 3;
    if (points.length < minimum) return;
    setDraft([]);
    if (tool === 'area') actions.addArea(pageIndex, points);
    else if (tool === 'perimeter') actions.addPolyline(pageIndex, points, true);
    else if (tool === 'polylength') actions.addPolyline(pageIndex, points, false);
    else if (tool === 'polygon') actions.addShape(pageIndex, { kind: 'polygon', points });
    else if (tool === 'cloud') actions.addShape(pageIndex, { kind: 'cloud', points });
  };

  /** Drop a trailing vertex that repeats the one before it (a double-click's second click). */
  const withoutRepeatedLast = (points: Point[]): Point[] => {
    if (points.length < 2) return points;
    const a = points[points.length - 2]!;
    const b = points[points.length - 1]!;
    const [ax, ay] = toPx(a);
    const [bx, by] = toPx(b);
    return Math.hypot(ax - bx, ay - by) < 4 ? points.slice(0, -1) : points;
  };

  const onClick = (event: KonvaEventObject<MouseEvent>) => {
    const p = pointerPdf(event);
    if (!p) return;
    if (tool === 'select' || tool === 'text') {
      // The click that ends a marquee drag must not clear what the marquee selected.
      if (justMarqueed.current) {
        justMarqueed.current = false;
        return;
      }
      if (event.target === event.target.getStage()) actions.select(undefined);
      return;
    }
    if (tool === 'calibrate' || tool === 'length') {
      if (draft.length === 0) {
        setDraft([p]);
        return;
      }
      const a = draft[0]!;
      setDraft([]);
      if (tool === 'length') {
        if (!doc?.pageScales.get(pageIndex)) {
          actions.setStatus('Calibrate this page first');
          return;
        }
        actions.addLength(pageIndex, a, p);
      } else {
        setCalibrating([a, p]);
      }
      return;
    }
    if (tool === 'count') {
      actions.addCount(pageIndex, p);
      return;
    }
    if (tool === 'callout' && calloutTarget === undefined) {
      setCalloutTarget(p);
      return;
    }
    if (tool === 'note') {
      setEditor({ kind: 'note', at: p });
      return;
    }
    if (tool === 'stamp') {
      void actions.addStampAt(pageIndex, p);
      return;
    }
    if (tool === 'line' || tool === 'arrow') {
      if (draft.length === 0) {
        setDraft([p]);
        return;
      }
      const a = draft[0]!;
      setDraft([]);
      if (a.x === p.x && a.y === p.y) return;
      actions.addShape(pageIndex, { kind: tool, start: a, end: p });
      return;
    }
    if (tool === 'rectarea') {
      if (!doc?.pageScales.get(pageIndex)) {
        actions.setStatus('Calibrate this page first');
        return;
      }
      if (draft.length === 0) {
        setDraft([p]);
        return;
      }
      const a = draft[0]!;
      setDraft([]);
      if (a.x === p.x || a.y === p.y) return;
      actions.addArea(pageIndex, [a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }]);
      return;
    }
    if (isPolyTool) {
      if (tool !== 'polygon' && tool !== 'cloud' && !doc?.pageScales.get(pageIndex)) {
        actions.setStatus('Calibrate this page first');
        return;
      }
      // Clicking the first vertex again closes an area or perimeter.
      if (closesDraft && draft.length >= 3) {
        const [fx, fy] = toPx(draft[0]!);
        const [px, py] = toPx(p);
        if (Math.hypot(fx - px, fy - py) < 10) {
          finishPoly(draft);
          return;
        }
      }
      setDraft([...draft, p]);
    }
  };

  const onDblClick = (event: KonvaEventObject<MouseEvent>) => {
    if (tool === 'select') {
      const p = pointerPdf(event);
      if (!p) return;
      const hit = markups.find(
        (m) =>
          (m.rawSubtype === 'FreeText' || m.rawSubtype === 'Text') &&
          p.x >= m.rect[0] &&
          p.x <= m.rect[2] &&
          p.y >= m.rect[1] &&
          p.y <= m.rect[3],
      );
      if (hit) {
        const rect: PdfRect =
          hit.rawSubtype === 'Text'
            ? [hit.rect[0], hit.rect[1] - 40, hit.rect[0] + 200, hit.rect[1]]
            : hit.geometry.kind === 'rect'
              ? hit.geometry.rect
              : hit.rect;
        setEditor({
          kind: 'edit',
          id: hit.id,
          rect,
          initial: hit.text?.contents ?? '',
          singleLine: hit.rawSubtype === 'Text',
        });
      }
      return;
    }
    if (!isPolyTool) return;
    // Konva fires dblclick for ANY two clicks within its window, even at different
    // positions; only a genuine double-click (second click on top of the first) finishes.
    // Read the ref: the click that preceded this event may already have updated the draft.
    const current = draftRef.current;
    const trimmed = withoutRepeatedLast(current);
    if (trimmed.length === current.length) return;
    finishPoly(trimmed);
  };

  /** Page-pixel position of the pointer (layer coordinates). */
  const pointerPx = (event: KonvaEventObject<MouseEvent>): [number, number] | undefined => {
    const pos = event.target.getStage()?.getPointerPosition();
    return pos ? [pos.x + visible.left, pos.y + visible.top] : undefined;
  };

  const onMouseDown = (event: KonvaEventObject<MouseEvent>) => {
    if (isDragTool && event.evt.button === 0) {
      const p = pointerPdf(event);
      if (p) {
        dragDraft.current = [p];
        setDraft([p]);
      }
      return;
    }
    if (tool !== 'select' || event.evt.button !== 0) return;
    if (event.target !== event.target.getStage()) return;
    const px = pointerPx(event);
    if (!px) return;
    const m = { x0: px[0], y0: px[1], x1: px[0], y1: px[1] };
    marqueeRef.current = m;
    setMarquee(m);
  };

  const onMouseUp = (event: KonvaEventObject<MouseEvent>) => {
    const dd = dragDraft.current;
    if (dd) {
      dragDraft.current = undefined;
      setDraft([]);
      const end = pointerPdf(event) ?? dd[dd.length - 1]!;
      const start = dd[0]!;
      if (tool === 'pen' || tool === 'highlighter') {
        const path = dd.length > 1 ? dd : [start, end];
        actions.addShape(pageIndex, { kind: tool, paths: [path] });
        return;
      }
      const [sx, sy] = toPx(start);
      const [ex, ey] = toPx(end);
      const tiny = Math.abs(ex - sx) < 3 || Math.abs(ey - sy) < 3;
      if (tool === 'textbox' || tool === 'callout') {
        // A click (no drag) makes a default 200 pt wide box that grows with its text.
        const rect: PdfRect = tiny
          ? [start.x, start.y, start.x + 200, start.y]
          : [
              Math.min(start.x, end.x),
              Math.min(start.y, end.y),
              Math.max(start.x, end.x),
              Math.max(start.y, end.y),
            ];
        if (tool === 'callout' && calloutTarget) {
          setEditor({ kind: 'callout', rect, target: calloutTarget });
        } else {
          setEditor({ kind: 'textbox', rect });
        }
        return;
      }
      if (tiny) return;
      const rect: [number, number, number, number] = [
        Math.min(start.x, end.x),
        Math.min(start.y, end.y),
        Math.max(start.x, end.x),
        Math.max(start.y, end.y),
      ];
      actions.addShape(pageIndex, { kind: tool === 'ellipse' ? 'ellipse' : 'rectangle', rect });
      return;
    }
    const m = marqueeRef.current;
    if (!m) return;
    marqueeRef.current = undefined;
    setMarquee(undefined);
    const left = Math.min(m.x0, m.x1);
    const top = Math.min(m.y0, m.y1);
    const right = Math.max(m.x0, m.x1);
    const bottom = Math.max(m.y0, m.y1);
    if (right - left < 4 && bottom - top < 4) return; // a plain click
    const hits = markups
      .filter((mk) => {
        const box = rectPx(mk.render === 'ap-bitmap' ? mk.rect : geometryBounds(mk), toPx);
        return (
          box.left < right &&
          box.left + box.width > left &&
          box.top < bottom &&
          box.top + box.height > top
        );
      })
      .map((mk) => mk.id);
    actions.selectMany(hits, event.evt.shiftKey);
    justMarqueed.current = true;
  };

  const onMouseMove = (event: KonvaEventObject<MouseEvent>) => {
    if (dragDraft.current) {
      const p = pointerPdf(event);
      if (!p) return;
      if (tool === 'pen' || tool === 'highlighter') {
        dragDraft.current.push(p);
        setDraft([...dragDraft.current]);
      } else {
        setDraft([dragDraft.current[0]!, p]);
      }
      return;
    }
    if (marqueeRef.current) {
      const px = pointerPx(event);
      if (px) {
        const m = { ...marqueeRef.current, x1: px[0], y1: px[1] };
        marqueeRef.current = m;
        setMarquee(m);
      }
      return;
    }
    if (tool === 'select' || tool === 'text') return;
    setHover(pointerPdf(event));
  };

  const markups = doc
    ? doc.markups.filter((m) => m.pageIndex === pageIndex && !m.flags.hidden)
    : [];
  const pageScale = doc?.pageScales.get(pageIndex);

  // Rubber-band preview for the tool in progress.
  let draftPoints = hover && draft.length ? [...draft, hover] : draft;
  if (
    (tool === 'rectarea' || tool === 'rectangle' || tool === 'textbox' || tool === 'callout') &&
    draftPoints.length === 2
  ) {
    const [a, b] = draftPoints as [Point, Point];
    draftPoints = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  }
  let draftLabel = '';
  if (pageScale && draftPoints.length >= 2) {
    const perPoint = worldUnitsPerPoint(pageScale.scale);
    const unit = pageScale.scale.worldUnit;
    if (tool === 'length' || tool === 'calibrate' || tool === 'polylength') {
      draftLabel = formatLength(polylineLength(draftPoints) * perPoint, pageScale.units, unit);
    } else if (tool === 'perimeter') {
      const loop = [...draftPoints, draftPoints[0]!];
      draftLabel = formatLength(polylineLength(loop) * perPoint, pageScale.units, unit);
    } else if ((tool === 'area' || tool === 'rectarea') && draftPoints.length >= 3) {
      draftLabel = formatArea(
        polygonArea(draftPoints) * perPoint * perPoint,
        pageScale.units,
        unit,
      );
    }
  }

  return (
    <>
      <div
        className="overlay"
        style={{
          left: visible.left,
          top: visible.top,
          width: Math.max(0, visible.width),
          height: Math.max(0, visible.height),
          cursor: tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair',
          // In Text mode the pdf.js text layer underneath owns selection; while panning
          // the viewer's own drag handler does.
          pointerEvents: tool === 'text' || panning ? 'none' : 'auto',
        }}
      >
        <Stage
          width={Math.max(1, visible.width)}
          height={Math.max(1, visible.height)}
          onClick={onClick}
          onDblClick={onDblClick}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onMouseMove={onMouseMove}
          onContextMenu={(event) => {
            event.evt.preventDefault();
            const p = pointerPdf(event);
            const hit = p
              ? [...markups]
                  .reverse()
                  .find(
                    (m) =>
                      p.x >= m.rect[0] - 4 &&
                      p.x <= m.rect[2] + 4 &&
                      p.y >= m.rect[1] - 4 &&
                      p.y <= m.rect[3] + 4,
                  )
              : undefined;
            const { selectedIds } = useEditorStore.getState();
            if (hit && !selectedIds.includes(hit.id)) actions.select(hit.id);
            setMenu({ x: event.evt.clientX, y: event.evt.clientY, markupId: hit?.id, at: p });
          }}
        >
          <Layer x={-visible.left} y={-visible.top}>
            {markups.map((m) => (
              <MarkupShape
                key={m.id}
                markup={m}
                selected={selectedIds.includes(m.id)}
                draggable={tool === 'select' && !m.flags.locked}
                toPx={toPx}
                toPdf={toPdf}
                zoom={viewport.scale}
                snap={snapVertex}
                interactive={tool === 'select'}
              />
            ))}
            {marquee && (
              <Rect
                x={Math.min(marquee.x0, marquee.x1)}
                y={Math.min(marquee.y0, marquee.y1)}
                width={Math.abs(marquee.x1 - marquee.x0)}
                height={Math.abs(marquee.y1 - marquee.y0)}
                stroke={SELECT_COLOR}
                strokeWidth={1}
                dash={[4, 3]}
                fill="rgba(2,136,209,0.08)"
                listening={false}
                name="marquee"
              />
            )}
            {tool === 'ellipse' && draftPoints.length === 2 && (
              <Ellipse
                x={(toPx(draftPoints[0]!)[0] + toPx(draftPoints[1]!)[0]) / 2}
                y={(toPx(draftPoints[0]!)[1] + toPx(draftPoints[1]!)[1]) / 2}
                radiusX={Math.abs(toPx(draftPoints[1]!)[0] - toPx(draftPoints[0]!)[0]) / 2}
                radiusY={Math.abs(toPx(draftPoints[1]!)[1] - toPx(draftPoints[0]!)[1]) / 2}
                stroke={DRAFT_COLOR}
                strokeWidth={2}
                dash={[6, 4]}
                listening={false}
              />
            )}
            {tool !== 'ellipse' && draftPoints.length > 0 && (
              <Line
                points={pointsPx(draftPoints)}
                globalCompositeOperation={tool === 'highlighter' ? 'multiply' : 'source-over'}
                stroke={DRAFT_COLOR}
                strokeWidth={2}
                dash={[6, 4]}
                closed={
                  (closesDraft ||
                    tool === 'rectangle' ||
                    tool === 'textbox' ||
                    tool === 'callout') &&
                  draftPoints.length > 2
                }
                fill={
                  closesDraft || tool === 'rectangle' || tool === 'textbox' || tool === 'callout'
                    ? 'rgba(211,47,47,0.12)'
                    : undefined
                }
                listening={false}
              />
            )}
            {draftPoints.map((p, i) => {
              const [x, y] = toPx(p);
              return (
                <Rect
                  key={i}
                  x={x - 3}
                  y={y - 3}
                  width={6}
                  height={6}
                  fill={DRAFT_COLOR}
                  listening={false}
                />
              );
            })}
            {snapHit && (
              <Rect
                x={toPx(snapHit)[0] - 5}
                y={toPx(snapHit)[1] - 5}
                width={10}
                height={10}
                stroke={SELECT_COLOR}
                strokeWidth={1.5}
                listening={false}
                name="snap-indicator"
              />
            )}
            {draftLabel && draftPoints[draftPoints.length - 1] && (
              <Text
                x={toPx(hover ?? draftPoints[draftPoints.length - 1]!)[0] + 8}
                y={toPx(hover ?? draftPoints[draftPoints.length - 1]!)[1] - 8}
                text={draftLabel}
                fontSize={12}
                fill={DRAFT_COLOR}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.markupId, pageIndex, menu.at, (m) => {
            const rect: PdfRect =
              m.rawSubtype === 'Text'
                ? [m.rect[0], m.rect[1] - 40, m.rect[0] + 200, m.rect[1]]
                : m.geometry.kind === 'rect'
                  ? m.geometry.rect
                  : m.rect;
            setEditor({
              kind: 'edit',
              id: m.id,
              rect,
              initial: m.text?.contents ?? '',
              singleLine: m.rawSubtype === 'Text',
            });
          })}
          onClose={() => setMenu(undefined)}
        />
      )}
      {editor && (
        <TextEditorOverlay
          editor={editor}
          toPx={toPx}
          zoom={viewport.scale}
          onDone={() => {
            setEditor(undefined);
            setCalloutTarget(undefined);
          }}
          pageIndex={pageIndex}
        />
      )}
      {calibrating && (
        <CalibrateDialog
          pointsDistance={Math.hypot(
            calibrating[1].x - calibrating[0].x,
            calibrating[1].y - calibrating[0].y,
          )}
          current={pageScale}
          defaults={useEditorStore.getState().profile.units}
          onCancel={() => setCalibrating(undefined)}
          onApply={(scale, units) => {
            setCalibrating(undefined);
            actions.calibrate(pageIndex, scale, units);
          }}
        />
      )}
    </>
  );
}

interface ShapeProps {
  markup: Markup;
  selected: boolean;
  draggable: boolean;
  toPx: (p: Point) => [number, number];
  toPdf: (x: number, y: number) => Point;
  zoom: number;
  snap: (id: string, p: Point, evt: MouseEvent) => Point;
  /** Only the Select tool selects on click; drawing tools let the click bubble to the page. */
  interactive: boolean;
}

function rectPx(rect: PdfRect, toPx: (p: Point) => [number, number]): Box {
  const [ax, ay] = toPx({ x: rect[0], y: rect[1] });
  const [bx, by] = toPx({ x: rect[2], y: rect[3] });
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  };
}

function MarkupShape({
  markup,
  selected,
  draggable,
  toPx,
  toPdf,
  zoom,
  snap,
  interactive,
}: ShapeProps) {
  const groupRef = useRef<Konva.Group>(null);
  const { style, geometry } = markup;
  const strokeWidth = Math.max(0.75, style.width * zoom);
  const stroke = css(style.stroke ?? { r: 0, g: 0, b: 0 }, style.opacity);
  const dash = style.dash?.map((d) => d * zoom);
  const fillAlpha = (style.fillOpacity ?? 1) * style.opacity;
  const fill = style.fill ? css(style.fill, fillAlpha) : undefined;

  const onDragEnd = () => {
    const group = groupRef.current;
    if (!group) return;
    const dx = group.x();
    const dy = group.y();
    group.position({ x: 0, y: 0 });
    // Convert the pixel delta to a user-space delta through the page transform.
    const origin = toPdf(0, 0);
    const moved = toPdf(dx, dy);
    actions.moveSelected(markup.id, moved.x - origin.x, moved.y - origin.y);
  };

  const onSelect = (event: KonvaEventObject<MouseEvent>) => {
    // Drawing tools click through: let the event bubble to the Stage, which draws.
    if (!interactive) return;
    event.cancelBubble = true;
    const { selectedIds } = useEditorStore.getState();
    if (event.evt.shiftKey || event.evt.ctrlKey) actions.toggleSelect(markup.id);
    else if (!selectedIds.includes(markup.id)) actions.select(markup.id);
  };

  const caption =
    markup.text?.contents && (markup.intent?.endsWith('Dimension') || markup.subtype === 'FreeText')
      ? markup.text.contents
      : undefined;

  let body: React.ReactNode;
  let captionAt: [number, number] | undefined;

  if (markup.render === 'ap-bitmap') {
    body = <ApBitmapShape markup={markup} toPx={toPx} zoom={zoom} />;
  } else if (geometry.kind === 'line') {
    const pts = geometry.points.flatMap(toPx);
    body = (
      <Line
        points={pts}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={dash}
        hitStrokeWidth={12}
        lineCap="round"
      />
    );
    captionAt = [(pts[0]! + pts[2]!) / 2, (pts[1]! + pts[3]!) / 2 - 14];
  } else if (geometry.kind === 'poly') {
    const isCloud = markup.intent === 'PolygonCloud' || !!style.cloud;
    const pts = isCloud
      ? cloudOutline(
          geometry.points,
          cloudRadius(style.width, style.cloud?.intensity ?? 1),
          6,
        ).flatMap(toPx)
      : geometry.points.flatMap(toPx);
    body = (
      <Line
        points={pts}
        closed={geometry.closed}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={dash}
        fill={geometry.closed ? fill : undefined}
        hitStrokeWidth={12}
        lineJoin="round"
      />
    );
    const box = rectPx(geometryBounds(markup), toPx);
    captionAt = [box.left + box.width / 2, box.top + box.height / 2 - 6];
  } else if (geometry.kind === 'ink') {
    body = (
      <>
        {geometry.paths.map((path, i) => (
          <Line
            key={i}
            points={path.flatMap(toPx)}
            stroke={stroke}
            strokeWidth={strokeWidth}
            dash={dash}
            hitStrokeWidth={12}
            lineCap="round"
            lineJoin="round"
            tension={0.2}
            globalCompositeOperation={style.blend === 'Multiply' ? 'multiply' : 'source-over'}
          />
        ))}
      </>
    );
  } else {
    const box = rectPx(geometry.kind === 'rect' ? geometry.rect : markup.rect, toPx);
    if (markup.subtype === 'Circle') {
      body = (
        <Ellipse
          x={box.left + box.width / 2}
          y={box.top + box.height / 2}
          radiusX={box.width / 2}
          radiusY={box.height / 2}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          fill={fill}
        />
      );
    } else if (markup.subtype === 'FreeText') {
      const leader = markup.callout;
      body = (
        <>
          {leader && leader.length >= 2 && (
            <Line
              points={leader.flatMap(toPx)}
              stroke={stroke}
              strokeWidth={Math.max(1, strokeWidth)}
              lineJoin="round"
              listening={false}
            />
          )}
          <Rect
            x={box.left}
            y={box.top}
            width={box.width}
            height={box.height}
            stroke={stroke}
            strokeWidth={strokeWidth}
            fill={fill ?? 'rgba(255,255,255,0.6)'}
          />
          <Text
            x={box.left + 2 * zoom}
            y={box.top + 2 * zoom}
            width={Math.max(4, box.width - 4 * zoom)}
            text={markup.text?.contents ?? ''}
            fontSize={Math.max(6, 10 * zoom)}
            fontFamily="Helvetica, Arial, sans-serif"
            fill={css(style.stroke ?? { r: 0, g: 0, b: 0 })}
            listening={false}
          />
        </>
      );
    } else {
      body = (
        <Rect
          x={box.left}
          y={box.top}
          width={box.width}
          height={box.height}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          fill={fill}
        />
      );
    }
  }

  const selBox = rectPx(markup.render === 'ap-bitmap' ? markup.rect : geometryBounds(markup), toPx);

  return (
    <Group ref={groupRef} draggable={draggable} onDragEnd={onDragEnd} onClick={onSelect}>
      {body}
      {caption && captionAt && markup.render === 'native' && (
        <Text
          x={captionAt[0] - 40}
          y={captionAt[1]}
          width={80}
          align="center"
          text={caption}
          fontSize={Math.max(7, 10 * zoom)}
          fontFamily="Helvetica, Arial, sans-serif"
          fill={css(style.stroke ?? { r: 0, g: 0, b: 0 })}
          listening={false}
        />
      )}
      {selected && (
        <Rect
          x={selBox.left - 3}
          y={selBox.top - 3}
          width={selBox.width + 6}
          height={selBox.height + 6}
          stroke={SELECT_COLOR}
          strokeWidth={1.5}
          dash={[4, 3]}
          listening={false}
        />
      )}
      {selected && draggable && (
        <Handles markup={markup} toPx={toPx} toPdf={toPdf} zoom={zoom} snap={snap} />
      )}
    </Group>
  );
}

/** The right-click menu for a markup (or the page when `markupId` is undefined). */
function menuItems(
  markupId: string | undefined,
  pageIndex: number,
  at: Point | undefined,
  editText: (m: Markup) => void,
): MenuItem[] {
  const state = useEditorStore.getState();
  const doc = getSession()?.doc;
  const markup = markupId ? doc?.markups.find((m) => m.id === markupId) : undefined;
  if (!markup) {
    return [
      {
        label: 'Paste',
        shortcut: 'Ctrl+V',
        disabled: state.clipboard.ids.length === 0,
        onSelect: () => actions.paste(),
      },
      {
        label: 'Select all on page',
        shortcut: 'Ctrl+A',
        onSelect: () => actions.selectAllOnPage(),
      },
      { separator: true, label: '' },
      { label: 'Calibrate scale…', shortcut: 'X', onSelect: () => actions.setTool('calibrate') },
      { label: 'Measure panel', onSelect: () => actions.setPanel('measure') },
      { separator: true, label: '' },
      {
        label: 'Stamp here',
        shortcut: 'S',
        disabled: !at,
        onSelect: () => {
          if (at) void actions.addStampAt(pageIndex, at);
        },
      },
    ];
  }
  const ids = state.selectedIds.includes(markup.id) ? state.selectedIds : [markup.id];
  const many = ids.length > 1;
  const locked = markup.flags.locked;
  const isText = markup.rawSubtype === 'FreeText' || markup.rawSubtype === 'Text';
  const items: MenuItem[] = [];
  if (isText && !many) {
    items.push({
      label: 'Edit text…',
      shortcut: 'Double-click',
      disabled: locked,
      onSelect: () => editText(markup),
    });
  }
  items.push(
    {
      label: 'Properties',
      shortcut: 'Ctrl+Shift+4',
      onSelect: () => actions.setPanel('properties'),
    },
    {
      label: 'Change subject…',
      disabled: locked,
      onSelect: () => {
        const next = window.prompt('Subject', markup.text?.subject ?? '');
        if (next && next.trim())
          actions.updateProperties({ subject: next.trim() }, ids, 'Change subject');
      },
    },
    {
      label: 'Add to Tool Chest',
      disabled: many,
      onSelect: () => actions.addToolFromMarkup(markup.id),
    },
    { separator: true, label: '' },
    { label: 'Copy', shortcut: 'Ctrl+C', onSelect: () => actions.copy() },
    {
      label: many ? `Duplicate ${ids.length}` : 'Duplicate',
      shortcut: 'Ctrl+D',
      disabled: locked,
      onSelect: () => actions.duplicate(),
    },
    { label: locked ? 'Unlock' : 'Lock', onSelect: () => actions.setLocked(ids, !locked) },
    {
      label: many ? `Flatten ${ids.length} markups` : 'Flatten',
      disabled: locked,
      onSelect: () => actions.flattenSelected(ids),
    },
    { separator: true, label: '' },
    {
      label: many ? `Delete ${ids.length} markups` : 'Delete',
      shortcut: 'Del',
      danger: true,
      disabled: locked,
      onSelect: () => actions.deleteMarkups(ids),
    },
  );
  void pageIndex;
  return items;
}

/** Positions the inline text editor over a page rect and commits to the right action. */
function TextEditorOverlay({
  editor,
  toPx,
  zoom,
  onDone,
  pageIndex,
}: {
  editor:
    | { kind: 'textbox'; rect: PdfRect }
    | { kind: 'callout'; rect: PdfRect; target: Point }
    | { kind: 'note'; at: Point }
    | { kind: 'edit'; id: string; rect: PdfRect; initial: string; singleLine: boolean };
  toPx: (p: Point) => [number, number];
  zoom: number;
  onDone: () => void;
  pageIndex: number;
}) {
  const rect: PdfRect =
    editor.kind === 'note'
      ? [editor.at.x, editor.at.y - 40, editor.at.x + 200, editor.at.y]
      : editor.rect;
  const box = rectPx(rect, toPx);
  const fontSize = Math.max(11, 10 * zoom);
  const commit = (text: string) => {
    if (editor.kind === 'textbox') actions.addTextBox(pageIndex, editor.rect, text);
    else if (editor.kind === 'callout')
      actions.addCallout(pageIndex, editor.rect, editor.target, text);
    else if (editor.kind === 'note') actions.addNote(pageIndex, editor.at, text);
    else actions.setText(editor.id, text);
    onDone();
  };
  return (
    <TextEditor
      left={box.left}
      top={box.top}
      width={box.width}
      height={box.height}
      fontSize={fontSize}
      initial={editor.kind === 'edit' ? editor.initial : ''}
      singleLine={editor.kind === 'note' || (editor.kind === 'edit' && editor.singleLine)}
      onCommit={commit}
      onCancel={onDone}
    />
  );
}

/**
 * Edit handles: one per vertex for lines / polylines / polygons (drag to move that vertex),
 * four corners for rectangle-shaped markups (drag to resize). Count symbols have a fixed
 * size and get none. Each drop is one undoable command.
 */
function Handles({
  markup,
  toPx,
  toPdf,
  zoom,
  snap,
}: {
  markup: Markup;
  toPx: (p: Point) => [number, number];
  toPdf: (x: number, y: number) => Point;
  zoom: number;
  snap: (id: string, p: Point, evt: MouseEvent) => Point;
}) {
  void zoom;
  const { geometry } = markup;
  const size = HANDLE;
  const common = {
    width: size,
    height: size,
    fill: '#fff',
    stroke: SELECT_COLOR,
    strokeWidth: 1.5,
    draggable: true,
    // Do not let a handle drag start the parent group's drag.
    onDragStart: (e: KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
    },
    onMouseDown: (e: KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
    },
  };

  if (geometry.kind === 'line' || geometry.kind === 'poly') {
    const points = geometry.points;
    return (
      <>
        {points.map((p, i) => {
          const [x, y] = toPx(p);
          return (
            <Rect
              key={i}
              {...common}
              name="vertex-handle"
              x={x - size / 2}
              y={y - size / 2}
              onDragEnd={(e) => {
                const node = e.target;
                const moved = snap(
                  markup.id,
                  toPdf(node.x() + size / 2, node.y() + size / 2),
                  e.evt,
                );
                node.position({ x: x - size / 2, y: y - size / 2 });
                const next = points.map((q, j) => (j === i ? moved : q));
                if (geometry.kind === 'line') {
                  actions.setGeometry(markup.id, {
                    kind: 'line',
                    points: [next[0]!, next[1]!],
                  });
                } else {
                  // A closed run (perimeter) keeps its last vertex on its first.
                  const closedRun =
                    points.length > 2 &&
                    points[0]!.x === points[points.length - 1]!.x &&
                    points[0]!.y === points[points.length - 1]!.y;
                  if (closedRun && (i === 0 || i === points.length - 1)) {
                    next[0] = moved;
                    next[points.length - 1] = moved;
                  }
                  actions.setGeometry(markup.id, { ...geometry, points: next });
                }
              }}
            />
          );
        })}
      </>
    );
  }

  if (geometry.kind === 'rect' && !countGroupOf(markup)) {
    const [x0, y0, x1, y1] = geometry.rect;
    const corners: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    return (
      <>
        {corners.map(([cx, cy], i) => {
          const [x, y] = toPx({ x: cx, y: cy });
          return (
            <Rect
              key={i}
              {...common}
              name="corner-handle"
              x={x - size / 2}
              y={y - size / 2}
              onDragEnd={(e) => {
                const node = e.target;
                const moved = snap(
                  markup.id,
                  toPdf(node.x() + size / 2, node.y() + size / 2),
                  e.evt,
                );
                node.position({ x: x - size / 2, y: y - size / 2 });
                const ox = i === 0 || i === 3 ? x1 : x0; // the opposite corner stays put
                const oy = i === 0 || i === 1 ? y1 : y0;
                const rect: [number, number, number, number] = [
                  Math.min(ox, moved.x),
                  Math.min(oy, moved.y),
                  Math.max(ox, moved.x),
                  Math.max(oy, moved.y),
                ];
                if (rect[2] - rect[0] < 1 || rect[3] - rect[1] < 1) return;
                actions.setGeometry(markup.id, { kind: 'rect', rect });
              }}
            />
          );
        })}
      </>
    );
  }
  return null;
}

/** PLAN §3.5 fallback: the annotation's own /AP rendered to a bitmap, else a labelled box. */
function ApBitmapShape({
  markup,
  toPx,
  zoom,
}: {
  markup: Markup;
  toPx: (p: Point) => [number, number];
  zoom: number;
}) {
  const [bitmap, setBitmap] = useState<ApBitmap | undefined | null>(undefined);
  const box = rectPx(markup.rect, toPx);
  useEffect(() => {
    let cancelled = false;
    setBitmap(undefined);
    renderApBitmap(markup, zoom).then((result) => {
      if (!cancelled) setBitmap(result ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [markup, markup.rect, zoom]);

  if (bitmap) {
    return (
      <KImage
        image={bitmap.canvas}
        x={box.left}
        y={box.top}
        width={box.width}
        height={box.height}
      />
    );
  }
  return (
    <>
      <Rect
        x={box.left}
        y={box.top}
        width={box.width}
        height={box.height}
        stroke="#888"
        strokeWidth={1}
        dash={[3, 3]}
        fill="rgba(0,0,0,0.04)"
      />
      <Text
        x={box.left + 2}
        y={box.top + 2}
        text={bitmap === null ? markup.rawSubtype : '…'}
        fontSize={10}
        fill="#666"
        listening={false}
      />
    </>
  );
}
