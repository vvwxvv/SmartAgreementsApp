"use client";

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CheckCircle, XCircle } from "lucide-react";
import { PatternAuth } from "@/utils/patternAuth";
import { LanguageContext } from "@/components/contexts/LanguageContext";
import useFont from "@/hooks/useFont";

// ============================================================================
// PATTERN LOCK — EDIT ME
//  1. COPY    → user-facing text per language (follows LanguageContext.isCn)
//  2. THEME   → colours
//  3. UNITS   → every size is a % of the card width → the whole lock keeps the
//               exact same proportions on a phone and on a 4K display
//  4. LAYOUT  → the card is centred with equal gutters (5% of the short edge)
//  5. PATTERN → grid, dot size, minimum points
// Fonts come from useFont(), so EN gets the brand Latin face and CN the brand
// CJK face automatically.
// ============================================================================

/* ── 1. COPY ───────────────────────────────────────────────────────────── */
/** `{min}` is replaced with PATTERN.MIN_POINTS at render time. */
export const COPY = {
  en: {
    title: "PATTERN AUTHENTICATION TO UNLOCK",
    tip: "Connect at least {min} points",
    clear: "CLEAR",
    unlock: "UNLOCK",
    incorrect: "INCORRECT PATTERN",
    success: "ACCESS GRANTED",
    tooShort: "MINIMUM {min} POINTS REQUIRED",
    aria: "Pattern lock. Draw your pattern on the 3 by 3 grid, then release.",
  },
  cn: {
    title: "图案认证解锁",
    tip: "至少连接 {min} 个点",
    clear: "清除",
    unlock: "解锁",
    incorrect: "图案错误",
    success: "访问已授权",
    tooShort: "至少需要 {min} 个点",
    aria: "图案锁。在 3×3 格点上绘制图案后松手。",
  },
};

/* ── 2. THEME ──────────────────────────────────────────────────────────── */
const THEME = {
  INK: "#000000",
  PAPER: "#FFFFFF",
  MUTED: "#6B6B6B",
};

/* ── 3. UNITS (1 unit = 1% of the card width) ──────────────────────────── */
const UNITS = {
  TITLE: 4.3, // title font size
  TITLE_TRACKING: "0.06em",
  TITLE_LINE_HEIGHT: 1.22,

  STATUS_SIZE: 3.3, // tip / alert text
  STATUS_HEIGHT: 8.4, // reserved row → layout never shifts
  STATUS_BORDER: 0.55,

  BORDER: 1.05, // canvas + button borders
  GAP: 3.2, // vertical rhythm

  BUTTON_SIZE: 3.5,
  BUTTON_HEIGHT: 11,
  BUTTON_GAP: 3,
  BUTTON_TRACKING: "0.08em",

  SHADOW_OFFSET: 1.55, // hard shadow on the canvas
  BUTTON_SHADOW: 1.05, // hard shadow on the buttons
  ICON: 3.8,
};

/* ── 4. LAYOUT ─────────────────────────────────────────────────────────── */
/**
 * The stage fills the viewport and centres the card.
 *   width = min(MAX_WIDTH, 60vw, (100vh − 2·vertical gutter) / ASPECT)
 * → 700px ceiling, a 1/5 screen gutter on each side above 1167px wide, and a
 *   near-full-width card on phones (<640px), where 1/5 would be useless.
 */
const LAYOUT = {
  MAX_WIDTH: 700, // px — the card never gets wider than this
  SIDE_GUTTER_RATIO: 0.2, // 1/5 of the viewport width on each side
  SMALL_SCREEN: 640, // below this width use the small fixed gutter instead
  VERTICAL_GUTTER_RATIO: 0.05, // 5% of the short edge, top and bottom
  GUTTER_MIN: 12,
  // title + status + gap + canvas(+borders) + gap + buttons, in UNITS
  CARD_ASPECT: 1.345,
  DEFAULT_WIDTH: 320, // pre-measure (SSR) width, replaced before paint
};

/* ── 5. PATTERN ────────────────────────────────────────────────────────── */
const PATTERN = {
  MIN_POINTS: 4,
  CANVAS_SIZE: 320, // internal drawing space (displayed size is responsive)
  GRID_SIZE: 3,
  POINT_RADIUS: 22,
  ACTIVE_POINT_RADIUS: 6,
  LINE_WIDTH: 2.5,
  HIT_SLOP: 5,
};

const fill = (template, vars) =>
  template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));

/* Card width for the current viewport — the one number everything scales from. */
function useCardWidth() {
  const [width, setWidth] = useState(LAYOUT.DEFAULT_WIDTH);

  useEffect(() => {
    const measure = () => {
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = document.documentElement.clientHeight || window.innerHeight;
      const vGutter = Math.max(
        LAYOUT.GUTTER_MIN,
        Math.min(vw, vh) * LAYOUT.VERTICAL_GUTTER_RATIO
      );
      const availH = Math.max(160, vh - vGutter * 2);

      /* 1/5 of the screen on each side, except on phones (where that would
         leave the card tiny) — those get a small fixed gutter instead. */
      const byGutter =
        vw >= LAYOUT.SMALL_SCREEN
          ? vw * (1 - LAYOUT.SIDE_GUTTER_RATIO * 2)
          : vw - LAYOUT.GUTTER_MIN * 2;

      setWidth(
        Math.min(
          LAYOUT.MAX_WIDTH,
          Math.max(160, byGutter),
          availH / LAYOUT.CARD_ASPECT
        )
      );
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  return width;
}

/**
 * @param {Function} [onSuccess] called with the accepted pattern
 * @param {(pattern:number[]) => boolean | Promise<boolean>} [verify]
 *        optional server-side verifier (the generator shell passes one that
 *        hits /api/auth/pattern). Falls back to PatternAuth when omitted.
 */
export default function PatternLock({ onSuccess, verify }) {
  const { isCn } = useContext(LanguageContext);
  const { labelFontFamily, buttonFontFamily } = useFont("label");
  const reduceMotion = useReducedMotion();

  const cardWidth = useCardWidth();
  /* 1 unit = 1% of card width → px */
  const u = useCallback((n) => Math.round((cardWidth * n) / 100), [cardWidth]);
  const borderPx = u(UNITS.BORDER);

  const canvasRef = useRef(null);
  const pointerIdRef = useRef(null);
  const selectedRef = useRef([]);
  const validatingRef = useRef(false);
  const timersRef = useRef([]);

  const [selected, setSelected] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoint, setCurrentPoint] = useState(null);
  const [alertConfig, setAlertConfig] = useState({
    open: false,
    severity: "error",
    message: "",
  });
  const [isValidating, setIsValidating] = useState(false);

  const t = COPY[isCn ? "cn" : "en"];

  /* ----------  timers  ---------- */
  const later = useCallback((fn, ms) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
  }, []);

  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    },
    []
  );

  /* ----------  3×3 grid  ---------- */
  const points = useMemo(() => {
    const { CANVAS_SIZE, GRID_SIZE } = PATTERN;
    const spacing = CANVAS_SIZE / (GRID_SIZE + 1);
    const arr = [];
    let id = 1;
    for (let row = 0; row < GRID_SIZE; row += 1) {
      for (let col = 0; col < GRID_SIZE; col += 1) {
        arr.push({ id: id++, x: spacing * (col + 1), y: spacing * (row + 1) });
      }
    }
    return arr;
  }, []);

  /* ----------  canvas render (crisp at any display size)  ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { CANVAS_SIZE, POINT_RADIUS, ACTIVE_POINT_RADIUS, LINE_WIDTH } = PATTERN;
    const cssSize = Math.max(1, cardWidth - borderPx * 2);
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(cssSize * dpr);

    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }

    // draw in the 320-unit design space, scaled to the real pixel buffer
    const k = canvas.width / CANVAS_SIZE;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    /* lines */
    if (selected.length) {
      ctx.strokeStyle = THEME.INK;
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineCap = "square";
      ctx.lineJoin = "miter";
      ctx.beginPath();
      selected.forEach((id, i) => {
        const p = points.find((v) => v.id === id);
        if (!p) return;
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      if (isDrawing && currentPoint) ctx.lineTo(currentPoint.x, currentPoint.y);
      ctx.stroke();
    }

    /* dots — square outline + circle, filled while selected */
    points.forEach((p) => {
      const active = selected.includes(p.id);
      const squareSize = POINT_RADIUS * 1.6;

      ctx.strokeStyle = THEME.INK;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(
        p.x - squareSize / 2,
        p.y - squareSize / 2,
        squareSize,
        squareSize
      );

      ctx.beginPath();
      ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = active ? THEME.INK : THEME.PAPER;
      ctx.fill();
      ctx.stroke();

      if (active) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, ACTIVE_POINT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = THEME.PAPER;
        ctx.fill();
      }
    });
  }, [selected, currentPoint, isDrawing, points, cardWidth, borderPx]);

  /* ----------  coordinates  ---------- */
  const getCanvasCoordinates = useCallback(
    (clientX, clientY) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const inner = rect.width - borderPx * 2;
      if (!inner || !rect.height) return null;
      return {
        x: ((clientX - rect.left - borderPx) * PATTERN.CANVAS_SIZE) / inner,
        y: ((clientY - rect.top - borderPx) * PATTERN.CANVAS_SIZE) / inner,
      };
    },
    [borderPx]
  );

  const getPoint = useCallback(
    (clientX, clientY) => {
      const coords = getCanvasCoordinates(clientX, clientY);
      if (!coords) return null;
      return (
        points.find(
          (p) =>
            Math.hypot(coords.x - p.x, coords.y - p.y) <=
            PATTERN.POINT_RADIUS + PATTERN.HIT_SLOP
        ) || null
      );
    },
    [getCanvasCoordinates, points]
  );

  /* ----------  selection state  ---------- */
  const updateSelected = useCallback((updater) => {
    setSelected((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      selectedRef.current = next;
      return next;
    });
  }, []);

  /* ----------  validation  ---------- */
  const validatePattern = useCallback(
    async (pattern) => {
      const deduped = [...new Set(pattern)];
      if (deduped.length < PATTERN.MIN_POINTS) {
        return {
          valid: false,
          message: fill(t.tooShort, { min: PATTERN.MIN_POINTS }),
          severity: "warning",
        };
      }

      let ok = false;
      try {
        // A `verify` prop means the secret lives on the server (preferred);
        // without it we fall back to the client-side PatternAuth check.
        ok = verify
          ? Boolean(await verify(deduped))
          : PatternAuth.validatePattern(deduped);
      } catch {
        ok = false;
      }

      return ok
        ? { valid: true, message: t.success, severity: "success" }
        : { valid: false, message: t.incorrect, severity: "error" };
    },
    [t, verify]
  );

  const validateAndHandlePattern = useCallback(
    async (pattern) => {
      if (validatingRef.current) return;
      validatingRef.current = true;
      setIsValidating(true);

      const result = await validatePattern(pattern);
      setAlertConfig({
        open: true,
        severity: result.severity,
        message: result.message,
      });

      if (result.valid) {
        later(() => {
          setAlertConfig({ open: false, severity: "error", message: "" });
          validatingRef.current = false;
          setIsValidating(false);
          if (onSuccess) onSuccess(pattern);
        }, 1200);
      } else {
        later(() => {
          updateSelected([]);
          setAlertConfig({ open: false, severity: "error", message: "" });
          validatingRef.current = false;
          setIsValidating(false);
        }, 2000);
      }
    },
    [later, onSuccess, updateSelected, validatePattern]
  );

  /* ----------  pointer handlers  ---------- */
  const handlePointerDown = useCallback(
    (event) => {
      if (validatingRef.current) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      pointerIdRef.current = event.pointerId;

      setIsDrawing(true);
      setCurrentPoint(null);

      const point = getPoint(event.clientX, event.clientY);
      updateSelected(point ? [point.id] : []);
    },
    [getPoint, updateSelected]
  );

  const handlePointerMove = useCallback(
    (event) => {
      if (!isDrawing || validatingRef.current) return;
      if (pointerIdRef.current !== event.pointerId) return;

      const coords = getCanvasCoordinates(event.clientX, event.clientY);
      if (coords) setCurrentPoint(coords);

      const point = getPoint(event.clientX, event.clientY);
      if (point) {
        updateSelected((prev) =>
          prev.includes(point.id) ? prev : [...prev, point.id]
        );
      }
    },
    [getCanvasCoordinates, getPoint, isDrawing, updateSelected]
  );

  const handlePointerEnd = useCallback(
    (event) => {
      if (pointerIdRef.current !== event.pointerId) return;
      pointerIdRef.current = null;

      if (!isDrawing || validatingRef.current) return;
      setIsDrawing(false);
      setCurrentPoint(null);

      const pattern = selectedRef.current;
      if (pattern.length) validateAndHandlePattern(pattern);
    },
    [isDrawing, validateAndHandlePattern]
  );

  const handleClear = useCallback(() => {
    if (validatingRef.current) return;
    updateSelected([]);
    setAlertConfig({ open: false, severity: "error", message: "" });
  }, [updateSelected]);

  const handleUnlock = useCallback(() => {
    if (selectedRef.current.length >= PATTERN.MIN_POINTS) {
      validateAndHandlePattern(selectedRef.current);
    }
  }, [validateAndHandlePattern]);

  /* ----------  derived UI state  ---------- */
  const canUnlock = selected.length >= PATTERN.MIN_POINTS && !isValidating;
  const canClear = selected.length > 0 && !isValidating;

  const fade = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : {};

  const shadow = `0 ${u(UNITS.SHADOW_OFFSET)}px 0 0 ${THEME.INK}`;
  const buttonShadow = `${u(UNITS.BUTTON_SHADOW)}px ${u(UNITS.BUTTON_SHADOW)}px 0 0 ${THEME.INK}`;

  /* ----------  render  ---------- */
  return (
    <div
      className="w-full"
      style={{
        backgroundColor: THEME.PAPER,
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        // horizontal gutter already lives in the card width, so no inline padding
        paddingBlock: `max(${LAYOUT.GUTTER_MIN}px, ${LAYOUT.VERTICAL_GUTTER_RATIO * 100}vmin)`,
        paddingInline: 0,
        boxSizing: "border-box",
        overflow: "clip",
      }}
    >
      <motion.div
        {...fade}
        style={{ width: cardWidth, maxWidth: "100%", boxSizing: "border-box" }}
      >
        {/* Title */}
        <h1
          style={{
            fontFamily: labelFontFamily,
            fontSize: u(UNITS.TITLE),
            fontWeight: 700,
            letterSpacing: UNITS.TITLE_TRACKING,
            lineHeight: UNITS.TITLE_LINE_HEIGHT,
            color: THEME.INK,
            margin: 0,
            textAlign: "center",
            overflowWrap: "break-word",
          }}
        >
          {t.title}
        </h1>

        {/* Status row — fixed height, so nothing moves when an alert appears */}
        <div
          aria-live="polite"
          style={{
            height: u(UNITS.STATUS_HEIGHT),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {alertConfig.open ? (
              <motion.div
                key="alert"
                initial={{ opacity: 0, y: reduceMotion ? 0 : u(0.8) }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : u(0.8) }}
                transition={{ duration: 0.22 }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: u(1.2),
                  maxWidth: "100%",
                  padding: `${u(1.05)}px ${u(1.8)}px`,
                  border: `${u(UNITS.STATUS_BORDER)}px solid ${THEME.INK}`,
                  backgroundColor: THEME.PAPER,
                  color: THEME.INK,
                  fontFamily: labelFontFamily,
                  fontSize: u(UNITS.STATUS_SIZE),
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                }}
              >
                {alertConfig.severity === "success" ? (
                  <CheckCircle size={u(UNITS.ICON)} strokeWidth={2.4} aria-hidden="true" />
                ) : (
                  <XCircle size={u(UNITS.ICON)} strokeWidth={2.4} aria-hidden="true" />
                )}
                <span>{alertConfig.message}</span>
              </motion.div>
            ) : (
              <motion.p
                key="tip"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                style={{
                  fontFamily: labelFontFamily,
                  fontSize: u(UNITS.STATUS_SIZE),
                  letterSpacing: "0.04em",
                  lineHeight: 1.2,
                  color: THEME.MUTED,
                  margin: 0,
                  textAlign: "center",
                }}
              >
                {fill(t.tip, { min: PATTERN.MIN_POINTS })}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Canvas + buttons */}
        <div
          style={{
            marginTop: u(UNITS.GAP),
            display: "flex",
            flexDirection: "column",
            gap: u(UNITS.GAP),
          }}
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={t.aria}
            className="block touch-none"
            style={{
              // content-box + border means the border sits outside `100%`
              width: `calc(100% - ${borderPx * 2}px)`,
              aspectRatio: "1 / 1",
              boxSizing: "content-box",
              maxWidth: "100%",
              border: `${borderPx}px solid ${THEME.INK}`,
              backgroundColor: THEME.PAPER,
              boxShadow: shadow,
              cursor: isValidating ? "default" : "crosshair",
              touchAction: "none",
              display: "block",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onContextMenu={(e) => e.preventDefault()}
          />

          <div
            className="grid grid-cols-2"
            style={{ gap: u(UNITS.BUTTON_GAP) }}
          >
            <motion.button
              type="button"
              onClick={handleClear}
              disabled={!canClear}
              whileHover={canClear ? { x: -u(0.5), y: -u(0.5) } : undefined}
              whileTap={canClear ? { scale: 0.98 } : undefined}
              transition={{ duration: 0.2 }}
              style={{
                height: u(UNITS.BUTTON_HEIGHT),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: `${borderPx}px solid ${THEME.INK}`,
                backgroundColor: THEME.PAPER,
                color: THEME.INK,
                fontFamily: buttonFontFamily,
                fontSize: u(UNITS.BUTTON_SIZE),
                fontWeight: 700,
                letterSpacing: UNITS.BUTTON_TRACKING,
                boxShadow: canClear ? buttonShadow : "none",
                opacity: canClear ? 1 : 0.3,
                cursor: canClear ? "pointer" : "default",
              }}
            >
              <span style={{ color: THEME.INK }}>{t.clear}</span>
            </motion.button>

            <motion.button
              type="button"
              onClick={handleUnlock}
              disabled={!canUnlock}
              whileHover={canUnlock ? { x: -u(0.5), y: -u(0.5) } : undefined}
              whileTap={canUnlock ? { scale: 0.98 } : undefined}
              transition={{ duration: 0.2 }}
              style={{
                height: u(UNITS.BUTTON_HEIGHT),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: `${borderPx}px solid ${THEME.INK}`,
                backgroundColor: canUnlock ? THEME.INK : THEME.PAPER,
                color: canUnlock ? THEME.PAPER : THEME.INK,
                fontFamily: buttonFontFamily,
                fontSize: u(UNITS.BUTTON_SIZE),
                fontWeight: 700,
                letterSpacing: UNITS.BUTTON_TRACKING,
                boxShadow: canUnlock ? buttonShadow : "none",
                opacity: canUnlock ? 1 : 0.3,
                cursor: canUnlock ? "pointer" : "default",
              }}
            >
              <span style={{ color: canUnlock ? THEME.PAPER : THEME.INK }}>
                {t.unlock}
              </span>
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
