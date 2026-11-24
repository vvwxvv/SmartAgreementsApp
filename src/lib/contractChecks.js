/**
 * Pre-send checks for a contract body.
 *
 * Real templates are full of blanks ("出租方：______") and template variables.
 * Sending one with the blanks still empty is the most embarrassing failure mode
 * for this product, so the manager UI warns before "create & send".
 */

const RULES = [
  { kind: "underscore", re: /_{3,}/g, label: "下划线空白" },
  { kind: "variable", re: /\{\{[^}]*\}\}/g, label: "模板变量" },
  { kind: "xx", re: /(^|[^A-Za-z])X{2,}([^A-Za-z]|$)/g, label: "XX 占位" },
  { kind: "bracket", re: /（\s*）|\(\s*\)/g, label: "空括号" },
];

/**
 * @param {string} text
 * @returns {{ kind: string, label: string, line: number, sample: string }[]}
 */
export function findPlaceholders(text) {
  const body = String(text || "");
  if (!body.trim()) return [];
  const out = [];
  const lines = body.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      const hit = rule.re.exec(line);
      if (!hit) continue;
      out.push({
        kind: rule.kind,
        label: rule.label,
        line: index + 1,
        sample: line.trim().slice(0, 80),
      });
    }
  });
  return out;
}

/** One-line summary for the UI: "第 12 行：下划线空白". */
export function describePlaceholders(issues, limit = 3) {
  return issues.slice(0, limit).map((it) => `第 ${it.line} 行 · ${it.label}`).join("；");
}
