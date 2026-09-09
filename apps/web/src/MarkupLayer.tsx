/**
 * Konva overlay for one page. Geometry comes from the `Markup` model in PDF user space
 * and is converted to CSS pixels through pdf.js's page viewport (which folds in /Rotate,
 * the CropBox origin and the y-flip), so screen pixels never leave this file.
 */

import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Group, Line, Rect, Ellipse, Text, Image as KImage } from 'react-konva';
import { countGroupOf } from '@redline/pdf-core';
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
import { actions, useEditor } from './store';
import { renderApBitmap, type ApBitmap } from './apBitmap';
import { CalibrateDialog } from './CalibrateDialog';

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
  const { doc, tool, selectedId, version, spacePan } = useEditor();
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
  const [calibrating, setCalibrating] = useState<[Point, Point] | undefined>();
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

  const isPolyTool = tool === 'area' || tool === 'polylength' || tool === 'perimeter';
  const closesDraft = tool === 'area' || tool === 'perimeter' || tool === 'rectarea';

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

  useEffect(() => setDraft([]), [tool]);

  const pointerPdf = (event: KonvaEventObject<MouseEvent>): Point | undefined => {
    const stage = event.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return undefined;
    return toPdf(pos.x + visible.left, pos.y + visible.top);
  };

  /** Complete the multi-vertex tool in progress, if it has enough vertices. */
  const finishPoly = (points: Point[]) => {
    const minimum = tool === 'polylength' ? 2 : 3;
    if (points.length < minimum) return;
    setDraft([]);
    if (tool === 'area') actions.addArea(pageIndex, points);
    else if (tool === 'perimeter') actions.addPolyline(pageIndex, points, true);
    else if (tool === 'polylength') actions.addPolyline(pageIndex, points, false);
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
      if (!doc?.pageScales.get(pageIndex)) {
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

  const onDblClick = () => {
    if (!isPolyTool) return;
    // Konva fires dblclick for ANY two clicks within its window, even at different
    // positions; only a genuine double-click (second click on top of the first) finishes.
    // Read the ref: the click that preceded this event may already have updated the draft.
    const current = draftRef.current;
    const trimmed = withoutRepeatedLast(current);
    if (trimmed.length === current.length) return;
    finishPoly(trimmed);
  };

  const onMouseMove = (event: KonvaEventObject<MouseEvent>) => {
    if (tool === 'select' || tool === 'text') return;
    setHover(pointerPdf(event));
  };

  const markups = doc
    ? doc.markups.filter((m) => m.pageIndex === pageIndex && !m.flags.hidden)
    : [];
  const pageScale = doc?.pageScales.get(pageIndex);

  // Rubber-band preview for the tool in progress.
  let draftPoints = hover && draft.length ? [...draft, hover] : draft;
  if (tool === 'rectarea' && draftPoints.length === 2) {
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
          onMouseMove={onMouseMove}
        >
          <Layer x={-visible.left} y={-visible.top}>
            {markups.map((m) => (
              <MarkupShape
                key={m.id}
                markup={m}
                selected={m.id === selectedId}
                draggable={tool === 'select'}
                toPx={toPx}
                toPdf={toPdf}
                zoom={viewport.scale}
              />
            ))}
            {draftPoints.length > 0 && (
              <Line
                points={pointsPx(draftPoints)}
                stroke={DRAFT_COLOR}
                strokeWidth={2}
                dash={[6, 4]}
                closed={closesDraft && draftPoints.length > 2}
                fill={closesDraft ? 'rgba(211,47,47,0.12)' : undefined}
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
      {calibrating && (
        <CalibrateDialog
          pointsDistance={Math.hypot(
            calibrating[1].x - calibrating[0].x,
            calibrating[1].y - calibrating[0].y,
          )}
          current={pageScale}
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

function MarkupShape({ markup, selected, draggable, toPx, toPdf, zoom }: ShapeProps) {
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
    actions.move(markup.id, moved.x - origin.x, moved.y - origin.y);
  };

  const onSelect = (event: KonvaEventObject<MouseEvent>) => {
    event.cancelBubble = true;
    actions.select(markup.id);
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
    const pts = geometry.points.flatMap(toPx);
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
      body = (
        <>
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
      {selected && draggable && <Handles markup={markup} toPx={toPx} toPdf={toPdf} zoom={zoom} />}
    </Group>
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
}: {
  markup: Markup;
  toPx: (p: Point) => [number, number];
  toPdf: (x: number, y: number) => Point;
  zoom: number;
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
                const moved = toPdf(node.x() + size / 2, node.y() + size / 2);
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
                const moved = toPdf(node.x() + size / 2, node.y() + size / 2);
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
