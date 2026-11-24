/**
 * 合同的「分段」模型。
 *
 * 页面里不再让运营者对着一个大 textarea 写 Markdown，而是：
 *   前言（可选） + 若干条款（标题 + 正文）
 * 发送前再拼回 Markdown 存进 `body`——指纹、PDF、签署页、证据包都不需要改。
 *
 * 解析/拼装必须可逆：切分只认二级标题（`## `），其余内容（列表、表格、引用）
 * 原样留在所属条款里；拼装时标题自动编号「第一条 / 第二条」。
 */

const HEADING = /^##[ \t]+(.+?)[ \t]*$/;

/** @returns {{intro: string, sections: Array<{heading: string, body: string}>}} */
export function parseContract(markdown) {
  const text = String(markdown || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const intro = [];
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const m = HEADING.exec(line);
    if (m) {
      cur = { heading: m[1].trim(), body: [] };
      sections.push(cur);
    } else if (cur) {
      cur.body.push(line);
    } else {
      intro.push(line);
    }
  }
  const trimBlock = (s) => s.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
  return {
    intro: trimBlock(intro),
    sections: sections.map((s) => ({ heading: s.heading, body: trimBlock(s.body) })),
  };
}

/** 第一条 / 第二条…… 已经带「第…条」的标题不重复编号。 */
export function numberOf(heading, index) {
  const h = String(heading || "").trim();
  if (!h) return "";
  // 已经自带编号的标题别再套一层：第N条 / 一、 / （一） / 1. / 1.1
  if (MANUAL_NUMBER.test(h)) return h;
  return `第${toChinese(index + 1)}条 ${h}`;
}

const DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
export function toChinese(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return String(n);
  if (num < 10) return DIGITS[num];
  if (num < 20) return "十" + (num % 10 ? DIGITS[num % 10] : "");
  if (num < 100) return DIGITS[Math.floor(num / 10)] + "十" + (num % 10 ? DIGITS[num % 10] : "");
  return String(num);
}

/** 拼回 Markdown：前言 + `## 第N条 标题` + 正文。空条款会被跳过。 */
export function composeContract({ intro, sections }) {
  const parts = [];
  const lead = String(intro || "").trim();
  if (lead) parts.push(lead);
  let n = 0;
  for (const s of sections || []) {
    const heading = String(s.heading || "").trim();
    const body = String(s.body || "").trim();
    if (!heading && !body) continue;
    if (heading) {
      parts.push(`## ${numberOf(heading, n)}\n\n${body}`.trimEnd());
      n += 1;
    } else if (body) {
      parts.push(body);
    }
  }
  return parts.join("\n\n");
}

/** 条款模板：标题 + 正文，变量用 {{partyA.name}} 这类占位符。 */
export const CONTRACT_TEMPLATES = [
  {
    id: "service",
    name: "服务合同（通用）",
    intro:
      "甲方与乙方经友好协商，就甲方委托乙方提供服务事宜，达成如下协议，共同遵守。",
    sections: [
      { heading: "服务内容", body: "乙方按双方确认的工作说明提供服务，范围包括：\n\n1. 需求调研与方案确认；\n2. 实施、交付与上线支持；\n3. 交付后 30 日内的缺陷修复。" },
      { heading: "服务期限", body: "自本合同生效之日起至项目验收完成之日止，预计不超过 6 个月。经双方书面确认可顺延。" },
      { heading: "费用与支付", body: "合同总价为人民币 ______ 元（含税）。\n\n- 首付款 40%：合同生效后 5 个工作日内支付；\n- 进度款 40%：阶段交付确认后支付；\n- 尾款 20%：验收合格后 10 个工作日内支付。" },
      { heading: "交付与验收", body: "乙方按约定时间提交交付物，甲方应在收到后 10 个工作日内完成验收；逾期未提出书面异议的，视为验收合格。" },
      { heading: "知识产权", body: "乙方交付成果的著作权归甲方所有；乙方在签约前已拥有的通用工具、组件及方法论仍归乙方，但授予甲方永久、免费的使用许可。" },
      { heading: "保密", body: "双方对合作过程中知悉的对方商业信息、技术资料承担保密义务，保密期限为合同终止后 3 年。" },
      { heading: "违约责任", body: "任何一方违反本合同约定，应赔偿对方因此遭受的直接损失；逾期付款或逾期交付的，每逾期一日按合同总价的 0.05% 支付违约金，累计不超过合同总价的 10%。" },
      { heading: "争议解决", body: "因本合同引起的争议，双方应友好协商解决；协商不成的，提交甲方所在地有管辖权的人民法院诉讼解决。" },
      { heading: "其他", body: "本合同自双方签署之日起生效，一式两份，双方各执一份，具有同等法律效力。未尽事宜由双方另行书面约定。" },
    ],
  },
  {
    id: "purchase",
    name: "采购合同",
    intro: "甲方（采购方）与乙方（供货方）就货物采购事宜，达成如下条款。",
    sections: [
      { heading: "标的与规格", body: "货物名称、型号、数量及技术参数以附件《采购清单》为准，附件与本合同具有同等效力。" },
      { heading: "价款", body: "合同总价为人民币 ______ 元（含税、含运费）。合同期内单价固定，不因市场波动调整。" },
      { heading: "交付", body: "乙方应于合同生效后 ______ 日内将货物送至甲方指定地点，运输风险自交付并验收合格时转移。" },
      { heading: "验收", body: "甲方按国家标准及附件约定验收；不合格的，乙方应在 7 日内更换或退货，费用由乙方承担。" },
      { heading: "质量保证", body: "质保期为验收合格之日起 12 个月。质保期内因产品质量问题造成的故障，乙方免费维修或更换。" },
      { heading: "付款", body: "验收合格并收到合规发票后 30 日内支付合同总价的 100%。" },
      { heading: "违约责任", body: "乙方逾期交付的，每逾期一日按逾期部分货款的 0.05% 支付违约金；甲方逾期付款的，按同一标准承担违约责任。" },
      { heading: "争议解决", body: "争议由双方协商解决；协商不成的，提交合同签订地人民法院诉讼解决。" },
    ],
  },
  {
    id: "nda",
    name: "保密协议（NDA）",
    intro: "甲方与乙方就双方合作中的保密事项达成如下协议。",
    sections: [
      { heading: "保密信息", body: "保密信息指一方以书面、口头、电子或其他形式披露的、标注或应合理认定为保密的技术、商业与经营信息。" },
      { heading: "保密义务", body: "接收方应：\n\n1. 仅为本合作目的使用保密信息；\n2. 采取不低于保护自身同类信息的谨慎程度；\n3. 未经披露方书面同意，不得向第三方披露。" },
      { heading: "例外", body: "接收方能证明属于下列情形的信息不受本协议约束：已公开、接收方独立开发、合法自第三方获得、依法应披露（应提前通知披露方）。" },
      { heading: "保密期限", body: "自披露之日起至合作终止后 3 年止；构成商业秘密的，保密义务持续至该信息进入公有领域。" },
      { heading: "违约责任", body: "违反本协议的一方应赔偿对方全部直接损失，并承担对方为维权支出的合理费用。" },
      { heading: "争议解决", body: "本协议适用中华人民共和国法律；争议提交披露方所在地人民法院诉讼解决。" },
    ],
  },
];

export function templateById(id) {
  return CONTRACT_TEMPLATES.find((t) => t.id === id) || null;
}


/** 已有编号的标题（第N条 / 一、 / （一） / 1. / 1.1）不再重复编号。 */
const MANUAL_NUMBER = /^(?:第[一二三四五六七八九十百零〇\d]+[条章节部分篇项]|[一二三四五六七八九十]+[、.．]|[（(][一二三四五六七八九十\d]+[)）]|\d+(?:\.\d+)*[.、)．](?=\s|$)|\d+(?:\.\d+)+\s)/;

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 「十二」→12；认不出来返回 0。 */
function cnToNumber(text) {
  if (/^\d+$/.test(text)) return Number(text);
  let total = 0;
  let unit = 0;
  for (const ch of text) {
    if (ch === "十") { total += (unit || 1) * 10; unit = 0; }
    else if (ch === "百") { total += (unit || 1) * 100; unit = 0; }
    else if (CN_DIGITS[ch] !== undefined) { unit = CN_DIGITS[ch]; }
    else return 0;
  }
  return total + unit;
}

/**
 * 渲染用编号。三级层次，全部自动：
 *
 *   ## 提交文件        → ## 第一条 提交文件
 *   ### 命名规则        → ### 1.1 命名规则      （父条编号 . 序号）
 *   #### 年代           → #### 1.1.1 年代       （父条.父节.序号）
 *
 * 标题里已经写了「第N条」「一、」「（一）」「1.」「1.1」的，保持原样，
 * 但会把编号读出来推进计数器，后面的自动编号不会撞号。
 */
export function numberHeadings(markdown) {
  let chapter = 0;
  let section = 0;
  let item = 0;

  const lines = String(markdown || "").split("\n");
  const numbered = lines.map((line) => {
    const m = /^(#{2,4})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (!m) return line;

    const hashes = m[1];
    const level = hashes.length;
    const heading = m[2].trim();

    if (level === 2) {
      section = 0;
      item = 0;
      const chinese = /^第([一二三四五六七八九十百零〇\d]+)条/.exec(heading);
      if (chinese) {
        const n = cnToNumber(chinese[1]);
        chapter = n > 0 ? n : chapter + 1;
        return `## ${heading}`;
      }
      if (MANUAL_NUMBER.test(heading)) {
        chapter += 1;
        return `## ${heading}`;
      }
      chapter += 1;
      return `## 第${toChinese(chapter)}条 ${heading}`;
    }

    if (level === 3) {
      item = 0;
      section += 1;
      if (MANUAL_NUMBER.test(heading)) return `### ${heading}`;
      return `### ${chapter || 1}.${section} ${heading}`;
    }

    item += 1;
    if (MANUAL_NUMBER.test(heading)) return `#### ${heading}`;
    return `#### ${chapter || 1}.${section || 1}.${item} ${heading}`;
  });

  return numbered.join("\n");
}

/** 标题锚点：保留中英文数字，去掉标点与空格。渲染与目录共用同一规则。 */
export function headingSlug(text) {
  const base = String(text || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5.-]/g, "");
  return base.slice(0, 64) || "section";
}

/**
 * 从（已编号的）Markdown 里抽标题，用于生成目录。
 * 只取 h2/h3：h4 太细，放目录会喧宾夺主。
 */
export function extractHeadings(markdown) {
  const out = [];
  for (const line of String(markdown || "").split("\n")) {
    const m = /^(#{2,3})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (!m) continue;
    const text = m[2].trim();
    out.push({ level: m[1].length, text, id: headingSlug(text) });
  }
  return out;
}

/**
 * 正文里手写的 `1.3` / `1.3.1` 不会跟着条款增删自动重编号（只有 `##`/`###` 会）。
 * 这里把它们和当前条款号对一下，不一致就提示运营者改用「＋子条款」。
 */
export function numberingIssues(sections) {
  const out = [];
  let chapter = 0;
  (sections || []).forEach((sec, i) => {
    if (String(sec.heading || "").trim()) chapter += 1;
    const body = String(sec.body || "");
    if (!body.trim() || !chapter) return;
    const line = body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => {
        const m = /^(\d+)\.(\d+)/.exec(l);
        return m && Number(m[1]) !== chapter;
      });
    if (line) out.push({ index: i, chapter, sample: line.slice(0, 18) });
  });
  return out;
}

/**
 * 识别「签署表」：Markdown 表格里同时出现签署动作与日期，并且提到甲乙双方。
 *
 * 真实合同在末尾常带一张
 *   | 甲方 名称/姓名：… 签字： 日期： |
 * 的表。电子协议会自己生成签署栏，这张表（含手写空格）留着只会重复且挤压。
 */
export function findSignatureTables(body) {
  const lines = String(body || "").split("\n");
  const blocks = [];
  let start = -1;
  for (let i = 0; i <= lines.length; i += 1) {
    const isRow = i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]);
    if (isRow && start === -1) start = i;
    if (!isRow && start !== -1) {
      blocks.push({ start, end: i - 1 });
      start = -1;
    }
  }
  const lastContent = lines.reduce((acc, l, i) => (l.trim() ? i : acc), -1);

  return blocks.filter(({ start: s, end: e }) => {
    const text = lines.slice(s, e + 1).join(" ");
    const signs = /(签字|签名|签署|签章|盖章|盖章处|Signature)/i.test(text);
    const dates = /(日期|Date)/i.test(text);
    const parties = /(甲方|乙方|Party\s*[AB])/i.test(text);
    if (!(signs && dates && parties)) return false;

    // 收紧条件（2026-11-24）：正文里「本协议签署后…按约定日期交付」的条款表
    // 也含签字/日期/甲方乙方，早期只靠三个关键词判断，会把整张条款表删掉。
    // 真正的签署表：行少、单元格短、并且就在文档末尾。
    if (e - s + 1 > 10) return false;
    const cells = lines
      .slice(s, e + 1)
      .flatMap((l) => l.split("|").map((c) => c.trim()))
      .filter((c) => c && !/^-{2,}$/.test(c));
    if (cells.some((c) => c.length > 32)) return false;
    // 表格后面最多再有两行内容（允许「备注」「日期」之类）
    const after = lines.slice(e + 1).filter((l) => l.trim());
    if (after.length > 2) return false;
    if (lastContent > 0 && e < lastContent - 2) return false;
    return true;
  });
}

/** 去掉签署表，并收敛多余空行。 */
export function stripSignatureTables(body) {
  const lines = String(body || "").split("\n");
  const blocks = findSignatureTables(body);
  if (!blocks.length) return String(body || "");
  const drop = new Set();
  for (const { start, end } of blocks) {
    for (let i = start; i <= end; i += 1) drop.add(i);
  }
  return lines
    .filter((_l, i) => !drop.has(i))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 交叉引用检查。
 *
 * 正文里「见第 8.7 条」「按第 2.3 条」是手写文本，条款增删、重排之后没人会去改它。
 * 这里把引用和实际存在的条款号对一遍，把断掉的引用指出来（只提示，不改内容）。
 */
export function referenceIssues(sections) {
  const bodies = (sections || []).map((s) => String(s.body || ""));
  const all = bodies.join("\n");
  const defined = new Set();
  for (const line of all.split("\n")) {
    // 段落首行：8.7 免费维护期的起算。
    const m = /^\s*(\d{1,2}(?:\.\d{1,2}){1,2})(?=[\s\u4e00-\u9fa5])/.exec(line);
    if (m) defined.add(m[1]);
    // 表格首列：| 8.7 | **免费维护期的起算。** …
    const cell = /^\s*\|\s*(\d{1,2}(?:\.\d{1,2}){1,2})\s*\|/.exec(line);
    if (cell) defined.add(cell[1]);
  }
  const chapterCount = (sections || []).filter((s) => String(s.heading || "").trim()).length;
  const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const cnToNum = (t) => {
    if (t.length === 1) return CN[t] || 0;
    if (t.length === 2 && t[0] === "十") return 10 + (CN[t[1]] || 0);
    if (t.length === 2 && t[1] === "十") return (CN[t[0]] || 0) * 10;
    if (t.length === 3 && t[1] === "十") return (CN[t[0]] || 0) * 10 + (CN[t[2]] || 0);
    return 0;
  };
  const out = [];
  (sections || []).forEach((sec, i) => {
    const body = String(sec.body || "");
    const refs = new Set();
    // 「第 8.4、8.7 条」「第 1.2 条」：一次可能点多个编号
    const re = /第\s*(\d{1,2}(?:\.\d{1,2}){1,2}(?:\s*[、,，和及]\s*\d{1,2}(?:\.\d{1,2}){1,2})*)\s*条/g;
    let m;
    while ((m = re.exec(body))) {
      for (const part of m[1].split(/[、,，和及]/)) {
        const t = part.trim();
        if (t) refs.add(t);
      }
    }
    // 章级引用：「第八条」= 第八章；「第三、四、九条」逐个查
    const cnRe = /第\s*([一二三四五六七八九十]{1,3}(?:\s*[、,，和及]\s*[一二三四五六七八九十]{1,3})*)\s*条/g;
    while ((m = cnRe.exec(body))) {
      for (const part of m[1].split(/[、,，和及]/)) {
        const n = cnToNum(part.trim());
        if (n > 0 && n > chapterCount) refs.add("第" + part.trim() + "条(章)");
      }
    }
    const missing = [...refs].filter((r) => (r.includes("(章)") ? true : !defined.has(r)));
    if (missing.length) out.push({ index: i, missing });
  });
  return out;
}

/**
 * 导入后自检：把「这份文档哪里可能有问题」一次说清，而不是让用户一个个点开看。
 *
 * 只读不改。返回结构：
 *   { chapters, subsections, tables, checks: [{ level, code, count, message }] }
 */
export function importChecks(sections) {
  const list = (sections || []).map((s) => ({
    heading: String(s.heading || ""),
    body: String(s.body || ""),
  }));
  const chapters = list.filter((s) => s.heading.trim()).length;
  const subsections = list.length - chapters;
  const tables = list.reduce((n, s) => n + (s.body.match(/^\s*\|.*\|\s*$/gm) || []).length, 0);
  const checks = [];
  const push = (level, code, count, message) => checks.push({ level, code, count, message });

  // 1 · 子条款编号与章节号不一致（Word 自动编号被拆散时最常见）
  const num = numberingIssues(list);
  if (num.length) {
    const first = num[0];
    push(
      "warn",
      "numbering",
      num.length,
      `${num.length} 段子条款的编号与所属章节对不上（例：第 ${first.chapter} 章里出现「${first.sample}」）`
    );
  }

  // 2 · 交叉引用断链
  const ref = referenceIssues(list);
  if (ref.length) {
    const missing = [...new Set(ref.flatMap((r) => r.missing))];
    push(
      "warn",
      "reference",
      missing.length,
      `正文引用了 ${missing.slice(0, 3).join("、")}${missing.length > 3 ? " 等" : ""}，但文中没有对应条款`
    );
  }

  // 3 · 残留签署表
  const sig = list.reduce((n, s) => n + findSignatureTables(s.body).length, 0);
  if (sig) push("warn", "signature", sig, `还有 ${sig} 张签署表，建议移除（应用会生成签署栏）`);

  // 4 · 没填的占位符
  const holders = [];
  list.forEach((s) => {
    const m = s.body.match(/(【[^】\n]{0,24}】|_{3,}|×{2,}|Ｘ{2,}|XX{2,}|TBD|待填|待定|xxx)/gi);
    if (m) holders.push(...m);
  });
  if (holders.length) {
    const uniq = [...new Set(holders.map((x) => x.trim()))];
    push("warn", "placeholder", holders.length, `有 ${holders.length} 处待填占位（${uniq.slice(0, 3).join("、")}${uniq.length > 3 ? " 等" : ""}），提交前请补实`);
  }

  // 5 · 空壳条款
  const empty = list.filter((s) => s.heading.trim() && s.body.replace(/[\s\-—]/g, "").length < 4);
  if (empty.length) push("warn", "empty", empty.length, `${empty.length} 个章节标题下面没有正文`);

  // 6 · 重复标题
  const seen = new Map();
  list.forEach((s) => {
    const h = s.heading.trim();
    if (!h) return;
    seen.set(h, (seen.get(h) || 0) + 1);
  });
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  if (dups.length) push("warn", "duplicate", dups.length, `标题重复：${dups.slice(0, 2).map(([h]) => `「${h}」`).join("、")}`);

  return { chapters, subsections, tables, checks };
}
