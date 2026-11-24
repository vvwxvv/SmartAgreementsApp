/** Pure helpers for rendering contract Markdown. */

const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

/**
 * The print/sign template already prints the agreement title. If the body
 * starts with an H1 that duplicates it, drop that line so the title is not
 * shown twice. Any other H1 is left alone.
 */
export function stripDuplicateTitle(markdown, title) {
  const md = String(markdown || "");
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (i >= lines.length) return md;
  // Templates often use "## 合同名"; the page already prints the title.
  const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[i].trim());
  if (!m) return md;
  const heading = norm(m[1]);
  const pageTitle = norm(title);
  if (!heading) return md;
  const same = heading === pageTitle;
  // "房屋租赁合同（星海科技·王欣）" vs heading "房屋租赁合同" is the same title
  // with an operator suffix. Only strip when the heading is long enough to be a
  // real title (not a generic word like "合同").
  const prefix = pageTitle.startsWith(heading) && heading.length >= 4;
  if (!same && !prefix) return md;
  lines.splice(i, 1);
  return lines.join("\n");
}
