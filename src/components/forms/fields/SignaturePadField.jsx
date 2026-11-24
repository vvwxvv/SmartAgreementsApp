"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Handwritten signature on a canvas.
 *
 * Strokes are kept as points and replayed whenever the canvas is resized
 * (rotation, window resize, mobile keyboard). Redrawing vectors keeps the ink
 * crisp and keeps its proportions; copying a bitmap would blur and stretch it.
 */
export default function SignaturePad({ value, onChange, height = 190 }) {
  const ref = useRef(null);
  const state = useRef({ drawing: false, last: null, lastTime: 0, lastWidth: 2.4, dirty: false, strokes: [] });
  const [empty, setEmpty] = useState(true);
  const valueRef = useRef(value);
  valueRef.current = value;

  function styleCtx(ctx) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    ctx.fillStyle = "#111";
  }

  function replay(ctx) {
    for (const stroke of state.current.strokes) {
      if (stroke.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke[0].x, stroke[0].y, 1.1, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      for (let i = 1; i < stroke.length; i += 1) {
        const p = stroke[i - 1];
        const q = stroke[i];
        ctx.lineWidth = q.w || 2.4;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }
  }

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    function paint() {
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(1, rect.width);
      const nextW = Math.floor(cssW * dpr);
      const nextH = Math.floor(height * dpr);
      if (canvas.width === nextW && canvas.height === nextH) return;

      canvas.width = nextW;
      canvas.height = nextH;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      styleCtx(ctx);

      // Points are stored in CSS pixels, so a change of width does not move
      // or distort what has already been written.
      if (state.current.strokes.length) {
        replay(ctx);
        return;
      }
      if (valueRef.current) {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(cssW / img.width, height / img.height);
          const w = img.width * k;
          const h = img.height * k;
          ctx.drawImage(img, (cssW - w) / 2, (height - h) / 2, w, h);
        };
        img.src = valueRef.current;
        state.current.dirty = true;
        setEmpty(false);
      }
    }

    paint();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(paint) : null;
    ro?.observe(canvas);
    window.addEventListener("orientationchange", paint);
    return () => {
      ro?.disconnect();
      window.removeEventListener("orientationchange", paint);
    };
  }, [height]);

  function pos(e) {
    const r = ref.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
  }

  function start(e) {
    e.preventDefault();
    ref.current.setPointerCapture?.(e.pointerId);
    const p = pos(e);
    state.current.drawing = true;
    state.current.last = p;
    state.current.lastTime = p.t;
    state.current.strokes.push([{ x: p.x, y: p.y, w: 2.2 }]);
    const ctx = ref.current.getContext("2d");
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  function move(e) {
    if (!state.current.drawing) return;
    e.preventDefault();
    const ctx = ref.current.getContext("2d");
    const p = pos(e);
    const last = state.current.last;
    const dt = Math.max(1, p.t - state.current.lastTime);
    const dist = Math.hypot(p.x - last.x, p.y - last.y);
    const speed = dist / dt;
    const target = Math.max(1.1, Math.min(3.2, 3.2 - speed * 2.2));
    const w = state.current.lastWidth * 0.7 + target * 0.3;
    state.current.lastWidth = w;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    state.current.strokes[state.current.strokes.length - 1].push({ x: p.x, y: p.y, w });
    state.current.last = p;
    state.current.lastTime = p.t;
    if (!state.current.dirty) {
      state.current.dirty = true;
      setEmpty(false);
    }
  }

  function end() {
    if (!state.current.drawing) return;
    state.current.drawing = false;
    emit();
  }

  /** Trim the transparent margin so the stored PNG is just the ink. */
  function emit() {
    const canvas = ref.current;
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    const { width: w, height: h } = canvas;
    const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = 0, maxY = 0, ink = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (data[(y * w + x) * 4 + 3] > 8) {
          ink += 1;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (ink / (w * h) < 0.002) {
      onChange("");
      setEmpty(true);
      return;
    }
    const pad = Math.round(6 * dpr);
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad);
    maxY = Math.min(h - 1, maxY + pad);
    const out = document.createElement("canvas");
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext("2d").drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    onChange(out.toDataURL("image/png"));
  }

  function clear() {
    const canvas = ref.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    state.current.strokes = [];
    state.current.dirty = false;
    state.current.lastWidth = 2.4;
    setEmpty(true);
    onChange("");
  }

  return (
    <div style={{ position: "relative", borderBottom: "1px dashed #d5d5d0", paddingBottom: 4 }}>
      <canvas
        ref={ref}
        className="ag-pad"
        style={{ height }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />
      {empty ? <div className="ag-pad-hint">在此签名</div> : null}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <span className="ag-note">用手指、触控笔或鼠标书写</span>
        <button
          type="button"
          onClick={clear}
          className="ag-btn--ghost"
          style={{ background: "none", border: 0, borderBottom: "1px solid #c9c9c4", cursor: "pointer", padding: "2px 0", fontSize: 11, color: "#6b6b6b" }}
        >
          清除
        </button>
      </div>
    </div>
  );
}
