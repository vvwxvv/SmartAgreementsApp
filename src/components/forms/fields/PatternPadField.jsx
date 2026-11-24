"use client";

import { useEffect, useRef, useState } from "react";

const SIZE = 240;
const PAD = 34;
const GAP = (SIZE - PAD * 2) / 2;
const DOTS = [];
for (let r = 0; r < 3; r += 1) {
  for (let c = 0; c < 3; c += 1) {
    DOTS.push({ id: r * 3 + c + 1, x: PAD + c * GAP, y: PAD + r * GAP, r: 0, c });
  }
}

const dotAt = (id) => DOTS.find((d) => d.id === id);

/** Straight-line interpolation: dragging from 1 to 9 passes through 5. */
function between(a, b) {
  const A = dotAt(a);
  const B = dotAt(b);
  if (!A || !B) return [];
  const dr = Math.sign(B.r - A.r);
  const dc = Math.sign(B.c - A.c);
  if (!dr || !dc || Math.abs(B.r - A.r) !== Math.abs(B.c - A.c)) return [];
  const out = [];
  for (let s = 1; s < Math.abs(B.r - A.r); s += 1) out.push((A.r + dr * s) * 3 + (A.c + dc * s) + 1);
  return out;
}

export default function PatternPad({ onComplete, min = 4, disabled = false, hint = "连接至少 4 个点" }) {
  const ref = useRef(null);
  const [seq, setSeq] = useState([]);
  const [cursor, setCursor] = useState(null);
  const drawing = useRef(false);
  // The commit callback must never run inside a setState updater: that makes
  // React update the parent while this component is rendering.
  const seqRef = useRef([]);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onDown = (e) => {
      if (disabled) return;
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      drawing.current = true;
      seqRef.current = [];
      setSeq([]);
      addAt(e);
    };
    const onMove = (e) => {
      if (!drawing.current || disabled) return;
      e.preventDefault();
      const p = point(e);
      setCursor(p);
      const hit = nearest(p);
      if (hit) addId(hit);
    };
    const onUp = () => {
      if (!drawing.current) return;
      drawing.current = false;
      setCursor(null);
      if (seqRef.current.length >= min) completeRef.current?.(seqRef.current);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, min]);

  function point(e) {
    const r = ref.current.getBoundingClientRect();
    const scale = SIZE / r.width;
    return { x: (e.clientX - r.left) * scale, y: (e.clientY - r.top) * scale };
  }

  function nearest(p) {
    const hit = DOTS.find((d) => Math.hypot(d.x - p.x, d.y - p.y) <= 26);
    return hit?.id || null;
  }

  function addId(id) {
    const s = seqRef.current;
    if (s.includes(id)) return;
    const last = s[s.length - 1];
    const through = last ? between(last, id).filter((x) => !s.includes(x)) : [];
    const next = [...s, ...through, id];
    seqRef.current = next;
    setSeq(next);
  }

  function addAt(e) {
    const hit = nearest(point(e));
    if (hit) addId(hit);
  }

  const path = seq.map((id) => dotAt(id)).filter(Boolean);

  return (
    <div className="ag-pattern">
      <svg
        ref={ref}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width="100%"
        style={{ touchAction: "none", maxWidth: SIZE, height: "auto", display: "block" }}
        role="application"
        aria-label="九点手势密码"
      >
        {path.length > 1 ? (
          <polyline
            points={[...path, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#111"
            strokeWidth="2.4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {DOTS.map((d) => {
          const on = seq.includes(d.id);
          return (
            <g key={d.id}>
              <circle cx={d.x} cy={d.y} r={17} fill={on ? "#111" : "#fff"} stroke={on ? "#111" : "#c9c9c4"} strokeWidth="1.2" />
              {!on ? <circle cx={d.x} cy={d.y} r={3.2} fill="#111" /> : null}
            </g>
          );
        })}
      </svg>

      <div className="ag-pattern-foot">
        <span className="ag-mono">{seq.length ? seq.join(" · ") : hint}</span>
        <button
          type="button"
          className="ag-mini"
          onClick={() => {
            seqRef.current = [];
            setSeq([]);
            completeRef.current?.([]);
          }}
        >
          重画
        </button>
      </div>
    </div>
  );
}
