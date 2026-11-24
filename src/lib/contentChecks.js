/**
 * 合同内容体检（2026-11-24）
 *
 * 导入自检只管「结构」（编号、引用、表格），不管「内容」。
 * 结果就是：一份没写保险免赔额的借展协议也能拿到全绿 —— 律师一秒就失去信任。
 *
 * 这里按合同类型列必备条款，逐条在正文里找。找不到就提示，不改任何内容。
 * 判断只做「有没有」，不做「写得好不好」，避免误报。
 */

const RULES = {
  // ── 通用 ────────────────────────────────────────────────────
  common: [
    { code: "effective", label: "生效条件", hint: "未写明协议何时生效（如「自双方签署之日起生效」）", re: /(自双方|经双方|双方签字|签字盖章|签署之日).{0,12}(生效|起生效)/ },
    { code: "dispute", label: "争议解决", hint: "未约定争议解决方式（仲裁或诉讼、管辖地）", re: /(仲裁|人民法院|诉讼|管辖|争议解决)/ },
    { code: "breach", label: "违约责任", hint: "未约定违约后果或违约金", re: /(违约金|违约责任|赔偿|损害赔偿)/ },
    { code: "force", label: "不可抗力", hint: "未约定不可抗力条款", re: /不可抗力/ },
    { code: "copies", label: "合同份数", hint: "未约定协议份数与各方持有", re: /一式\s*[两二三四五六]\s*份/ },
  ],

  // ── 借展 / 展览 ─────────────────────────────────────────────
  exhibition: [
    { code: "insurance", label: "保险", hint: "未约定保险（投保方 / 受益方 / 保额）", re: /(保险|投保|保额|一切险)/ },
    { code: "deductible", label: "免赔额", hint: "未约定出险时的免赔额/自负额由谁承担，艺术品保险最易扯皮的一条", re: /(免赔|自负额|自付额|deductible)/i },
    { code: "transport", label: "运输与包装", hint: "未约定运输方式与包装标准", re: /(运输|承运|包装|恒温|气垫)/ },
    { code: "environment", label: "展陈环境", hint: "未约定温湿度 / 照度等展陈环境条件", re: /(温度|相对湿度|湿度|照度|lux|紫外线)/i },
    { code: "handover", label: "点交与状况确认", hint: "未约定作品点交与状况确认程序", re: /(点交|状况确认|验收单|交接单|清单)/ },
    { code: "thirdparty", label: "第三方权利", hint: "未约定作品被出售、被主张优先购买权等第三方权利如何处理", re: /(优先购买|第三方权利|出售|转让.{0,6}藏品)/ },
  ],

  // ── 服务 / 开发 / 设计 ───────────────────────────────────────
  service: [
    { code: "scope", label: "交付范围", hint: "未明确交付物或服务范围", re: /(交付|交付物|服务范围|工作范围|成果)/ },
    { code: "accept", label: "验收标准", hint: "未约定验收标准或验收期限", re: /(验收|确认合格|认可)/ },
    { code: "payment", label: "付款节点", hint: "未约定付款节点（预付 / 尾款 / 到期日）", re: /(预付|首付款|尾款|付款|支付).{0,20}(日|天|%)/ },
    { code: "ip", label: "知识产权", hint: "未约定成果的著作权 / 知识产权归属", re: /(著作权|知识产权|版权|署名权)/ },
    { code: "change", label: "变更管理", hint: "未约定需求变更如何计价", re: /(变更|增项|追加|另行报价)/ },
    { code: "maintain", label: "维护与售后", hint: "未约定维护期或售后支持", re: /(维护|售后|质保|保修)/ },
  ],

  // ── 合作 / 分成 ─────────────────────────────────────────────
  partnership: [
    { code: "split", label: "分成比例", hint: "未写明分成比例或利润分配方式", re: /(分成|分成比例|利润分配|按.{0,6}%|比例)/ },
    { code: "settlement", label: "结算周期", hint: "未约定对账与结算周期", re: /(结算|对账|月结|季度)/ },
    { code: "exclusive", label: "排他与竞业", hint: "未约定是否排他 / 独家（不排他也建议写明）", re: /(排他|独家|竞业|非独家)/ },
    { code: "exit", label: "期限与退出", hint: "未约定合作期限或提前退出机制", re: /(合作期限|有效期|提前.{0,4}(终止|退出)|解除)/ },
  ],
};

/** 从标题 / category 猜合同类型；猜不出来按通用规则。 */
export function inferCategory({ category = "", title = "" } = {}) {
  const text = String(category || "") + " " + String(title || "");
  if (/(借展|展览|展出|藏品)/.test(text)) return "exhibition";
  if (/(合作|分成|联营|合伙|代销|分成)/.test(text)) return "partnership";
  if (/(服务|开发|设计|维护|咨询|外包|制作)/.test(text)) return "service";
  return null;
}

/**
 * @returns {{ category: string|null, total: number, missing: {code,label,hint}[] }}
 */
export function contentChecks(body, { category = "", title = "" } = {}) {
  const text = String(body || "");
  const kind = inferCategory({ category, title });
  const rules = kind ? RULES[kind] : [];
  const all = RULES.common.concat(rules);
  const missing = all.filter((r) => !r.re.test(text)).map((r) => ({ code: r.code, label: r.label, hint: r.hint }));
  return { category: kind, total: all.length, missing };
}
