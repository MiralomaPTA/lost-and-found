"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { moveBox, resizeFromCorner, scaleBox, type Box } from "@/lib/image/crop-box";

type Gesture =
  | { kind: "move" | "resize"; pointer: number; x: number; y: number; start: Box }
  | { kind: "pinch"; distance: number; start: Box }
  | null;

/**
 * The photo with its square crop box (spec: *Crop by hand*). Drag the box
 * to move it; pinch, or drag its corner, to resize. From the keyboard, the
 * arrow keys move it and + and − resize it. Everything outside the box is
 * dimmed. The box is kept in the photo's own pixels.
 */
export function CropArea({ image, box, onChange, label }: { image: ImageBitmap; box: Box; onChange: (box: Box) => void; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ width: 0, height: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture>(null);
  const latestBox = useRef(box);
  useEffect(() => {
    latestBox.current = box;
  }, [box]);

  // Fit the photo into the space, and follow it when the space changes size.
  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const fit = () => {
      const scale = Math.min(element.clientWidth / image.width, element.clientHeight / image.height);
      setView({ width: Math.floor(image.width * scale), height: Math.floor(image.height * scale) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [image]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !view.width) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(view.width * ratio);
    element.height = Math.round(view.height * ratio);
    const context = element.getContext("2d")!;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, element.width, element.height);
  }, [image, view]);

  const scale = view.width ? view.width / image.width : 1;
  const W = image.width;
  const H = image.height;

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  function down(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    wrap.current?.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      gesture.current = { kind: "pinch", distance: spread(), start: latestBox.current };
    } else if (pointers.current.size === 1) {
      const kind = target.dataset.handle ? "resize" : target.closest("[data-box]") ? "move" : null;
      gesture.current = kind ? { kind, pointer: event.pointerId, x: event.clientX, y: event.clientY, start: latestBox.current } : null;
    }
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const now = gesture.current;
    if (!now) return;
    if (now.kind === "pinch") {
      if (pointers.current.size === 2 && now.distance > 0) onChange(scaleBox(now.start, spread() / now.distance, W, H));
      return;
    }
    if (event.pointerId !== now.pointer) return;
    const dx = (event.clientX - now.x) / scale;
    const dy = (event.clientY - now.y) / scale;
    onChange(now.kind === "move" ? moveBox(now.start, dx, dy, W, H) : resizeFromCorner(now.start, dx, dy, W, H));
  }

  function up(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    const [left] = [...pointers.current.entries()];
    // One finger left after a pinch carries on as a move.
    gesture.current = left ? { kind: "move", pointer: left[0], x: left[1].x, y: left[1].y, start: latestBox.current } : null;
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    const step = Math.max(4, Math.round(Math.min(W, H) * (event.shiftKey ? 0.1 : 0.02)));
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      onChange(moveBox(box, moves[event.key][0], moves[event.key][1], W, H));
    } else if (event.key === "+" || event.key === "=") {
      onChange(scaleBox(box, 1.08, W, H));
    } else if (event.key === "-" || event.key === "_") {
      onChange(scaleBox(box, 1 / 1.08, W, H));
    } else {
      return;
    }
    event.preventDefault();
  }

  return (
    <div
      ref={wrap}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className="relative flex h-full w-full touch-none items-center justify-center overflow-hidden select-none"
    >
      <div className="relative overflow-hidden" style={{ width: view.width, height: view.height }}>
        <canvas ref={canvas} role="img" aria-label={label} className="block h-full w-full" />
        <div
          data-box
          tabIndex={0}
          role="group"
          aria-label="Crop box. Arrow keys move it; plus and minus resize it."
          onKeyDown={key}
          className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[#7D9BFF]"
          style={{ left: box.x * scale, top: box.y * scale, width: box.size * scale, height: box.size * scale }}
        >
          <span className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/45" />
          <span className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/45" />
          <span className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/45" />
          <span className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/45" />
          <span data-handle aria-hidden="true" className="absolute right-[3px] bottom-[3px] h-[26px] w-[26px] cursor-nwse-resize rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.45)]" />
        </div>
      </div>
    </div>
  );
}
