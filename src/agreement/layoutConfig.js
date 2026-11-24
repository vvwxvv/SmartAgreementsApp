/**
 * layoutConfig.js  (P2-1)
 *
 * The print layout is a *rendering* choice, never part of the contract text:
 * it is not in the fingerprint, not in the evidence record, and not stored by
 * this module. It becomes CSS variables, so every value is validated here —
 * an unvalidated config would be a CSS-injection entry point.
 *
 * Pure: no React, no next/*, no environment, no I/O.
 */

export const LAYOUT_PRESETS = Object.freeze(['simple', 'formal', 'modern', 'cover']);

export const LAYOUT_FONTS = Object.freeze({
  'noto-serif-sc': '"Noto Serif SC Subset", "Songti SC", SimSun, serif',
  'noto-sans-sc': '"Noto Sans SC Subset", "PingFang SC", "Microsoft YaHei", sans-serif',
  'system-serif': 'Georgia, "Times New Roman", serif',
  'system-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
});

export const LAYOUT_KEYS = Object.freeze([
  'preset', 'fontSerif', 'fontSans', 'accent', 'text', 'muted', 'paper', 'rule',
  'marginMm', 'fontSizePt', 'lineHeight', 'titleSizePt', 'cover', 'headerRule', 'footerNote',
]);

const COLOR_KEYS = ['accent', 'text', 'muted', 'paper', 'rule'];
const NUMBER_RANGES = Object.freeze({
  marginMm: [10, 40],
  fontSizePt: [8, 14],
  lineHeight: [1.2, 2.2],
  titleSizePt: [16, 40],
});
const HEX = /^#[0-9a-fA-F]{6}$/;
const TEXT_KEYS = ['headerRule', 'footerNote'];

export const PRESET_DEFAULTS = Object.freeze({
  simple: Object.freeze({
    preset: 'simple', fontSerif: 'noto-serif-sc', fontSans: 'noto-sans-sc',
    accent: '#111111', text: '#111111', muted: '#555555', paper: '#ffffff', rule: '#e3e3e3',
    marginMm: 20, fontSizePt: 10.5, lineHeight: 1.8, titleSizePt: 24,
    cover: false, headerRule: '', footerNote: '',
  }),
  formal: Object.freeze({
    preset: 'formal', fontSerif: 'noto-serif-sc', fontSans: 'noto-sans-sc',
    accent: '#1f3a5f', text: '#141414', muted: '#4b5a6a', paper: '#ffffff', rule: '#c9d3df',
    marginMm: 24, fontSizePt: 10.5, lineHeight: 1.9, titleSizePt: 26,
    cover: false, headerRule: '合同', footerNote: '',
  }),
  modern: Object.freeze({
    preset: 'modern', fontSerif: 'noto-serif-sc', fontSans: 'noto-sans-sc',
    accent: '#0f766e', text: '#15201f', muted: '#5b6b69', paper: '#ffffff', rule: '#d7e3e0',
    marginMm: 18, fontSizePt: 10, lineHeight: 1.7, titleSizePt: 28,
    cover: false, headerRule: '', footerNote: '',
  }),
  cover: Object.freeze({
    preset: 'cover', fontSerif: 'noto-serif-sc', fontSans: 'noto-sans-sc',
    accent: '#111111', text: '#111111', muted: '#555555', paper: '#ffffff', rule: '#dddddd',
    marginMm: 22, fontSizePt: 10.5, lineHeight: 1.8, titleSizePt: 30,
    cover: true, headerRule: '', footerNote: '',
  }),
});

export class LayoutConfigError extends Error {
  constructor(path, message) {
    super('layoutConfig.' + path + ': ' + message);
    this.name = 'LayoutConfigError';
    this.path = path;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Normalise a preset name or a partial config.
 * Returns null for "no layout" (legacy rendering), never throws for null/''.
 */
export function resolveLayoutConfig(input) {
  if (input === undefined || input === null || input === '') return null;

  let raw;
  if (typeof input === 'string') {
    raw = { preset: input };
  } else if (isPlainObject(input)) {
    raw = input;
  } else {
    throw new LayoutConfigError('', 'expected a preset name or an object');
  }

  const preset = raw.preset === undefined ? 'simple' : raw.preset;
  if (typeof preset !== 'string' || !LAYOUT_PRESETS.includes(preset)) {
    throw new LayoutConfigError('preset', 'unknown preset "' + String(preset) + '"');
  }

  const out = { ...PRESET_DEFAULTS[preset] };

  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (key === 'preset') continue;
    if (!LAYOUT_KEYS.includes(key)) {
      throw new LayoutConfigError(key, 'unknown key');
    }

    if (COLOR_KEYS.includes(key)) {
      if (typeof value !== 'string' || !HEX.test(value)) {
        throw new LayoutConfigError(key, 'must be a #rrggbb colour');
      }
      out[key] = value.toLowerCase();
      continue;
    }

    if (key === 'fontSerif' || key === 'fontSans') {
      if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(LAYOUT_FONTS, value)) {
        throw new LayoutConfigError(key, 'font must be one of ' + Object.keys(LAYOUT_FONTS).join(', '));
      }
      out[key] = value;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(NUMBER_RANGES, key)) {
      const [min, max] = NUMBER_RANGES[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw new LayoutConfigError(key, 'must be a number between ' + min + ' and ' + max);
      }
      out[key] = value;
      continue;
    }

    if (key === 'cover') {
      if (typeof value !== 'boolean') throw new LayoutConfigError(key, 'must be a boolean');
      out[key] = value;
      continue;
    }

    if (TEXT_KEYS.includes(key)) {
      if (typeof value !== 'string') throw new LayoutConfigError(key, 'must be a string');
      if (value.length > 120) throw new LayoutConfigError(key, 'max 120 characters');
      if (/[<>]/.test(value) || /[\u0000-\u001f]/.test(value)) {
        throw new LayoutConfigError(key, 'control characters and angle brackets are not allowed');
      }
      out[key] = value;
      continue;
    }

    throw new LayoutConfigError(key, 'unsupported');
  }

  return Object.freeze(out);
}

/** CSS custom properties for a resolved config. Only known keys are emitted. */
export function layoutToCssVars(config) {
  if (!config) return undefined;
  return {
    '--pd-accent': config.accent,
    '--pd-text': config.text,
    '--pd-muted': config.muted,
    '--pd-paper': config.paper,
    '--pd-rule': config.rule,
    '--pd-margin': config.marginMm + 'mm',
    '--pd-font-size': config.fontSizePt + 'pt',
    '--pd-line-height': String(config.lineHeight),
    '--pd-title-size': config.titleSizePt + 'pt',
    '--pd-font-serif': LAYOUT_FONTS[config.fontSerif],
    '--pd-font-sans': LAYOUT_FONTS[config.fontSans],
  };
}
