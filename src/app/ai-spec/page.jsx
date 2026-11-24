import Link from "next/link";
import CopyBlock from "@/components/others/CopyBlock";
import {
  AI_EXPORT_PROMPT,
  AI_EMPTY_TEMPLATE,
  AI_SPEC_VERSION,
  FRONT_MATTER_SKELETON,
} from "@/lib/aiExportSpec";

export const metadata = {
  title: "协议导出规范 v" + AI_SPEC_VERSION,
  description: "给 AI 模型的合同导出规范：front matter 标记 + 可被本应用直接解析的正文结构。",
};

/**
 * 公开页：模型可以直接抓 /ai-spec/raw 拿到纯文本，人在这里阅读和复制。
 */
export default function AiSpecPage() {
  return (
    <main className="agspec">
      <div className="agspec-inner">
        <div className="agspec-kicker">AGREEMENT · AI EXPORT SPEC v{AI_SPEC_VERSION}</div>
        <h1>让 AI 直接产出可导入的合同</h1>
        <p className="agspec-lead">
          把下面这段指令交给模型。它会在文件开头写一段 front matter（本应用识别的「对版标记」），
          并按可解析的结构写正文 —— 导入时不需要再猜标题、章节和当事人。
        </p>

        <div className="agspec-row">
          <span className="agspec-label">复制指令</span>
          <CopyBlock text={AI_EXPORT_PROMPT} label="复制完整指令" />
          <span className="agspec-label" style={{ marginLeft: 18 }}>复制空白模板</span>
          <CopyBlock text={AI_EMPTY_TEMPLATE} label="复制空白模板" />
          <a className="agspec-link" href="/ai-spec/raw" target="_blank" rel="noreferrer">纯文本版 ↗</a>
          <a className="agspec-link" href="/ai-spec/raw?template=1" target="_blank" rel="noreferrer">模板 .md ↗</a>
        </div>

        <h2>1 · 对版标记（front matter）</h2>
        <p>
          文件第一行开始、<code>---</code> 包围。只有 <code>agreement-app</code> 是必须的，其余可选；
          当事人名字会自动匹配系统里已建的主体。
        </p>
        <pre className="agspec-pre">{FRONT_MATTER_SKELETON}</pre>

        <h2>2 · 正文结构</h2>
        <ul className="agspec-list">
          <li>章节：<code>## 一、项目内容与费用</code> 或 <code>## 第N条 …</code></li>
          <li>子条款：单独成段，行首写 <code>1.1</code> / <code>8.7</code>，与所属章节号一致</li>
          <li>小标题：单独一行、整行加粗，如 <code>**服务范围与款式说明**</code></li>
          <li>表格：标准 Markdown 表格，不合并单元格、单元格内不换行</li>
          <li><strong>不要</strong>生成签署表、签字栏、日期栏 —— 系统会生成签署区</li>
          <li><strong>不要</strong>生成目录 —— 系统会生成</li>
        </ul>

        <h2>3 · 支持的格式</h2>
        <p>
          <code>.md</code> 最稳；<code>.docx</code> 与<strong>文本型</strong> <code>.pdf</code> 也可以，
          但 front matter 要作为正文第一段保留。扫描图片型 PDF 无法解析（没有 OCR）。
        </p>

        <h2>4 · 完整指令</h2>
        <pre className="agspec-pre">{AI_EXPORT_PROMPT}</pre>

        <p className="agspec-foot">
          导入入口：<Link href="/manager">管理端</Link> → 新建协议 → Import Word / PDF
        </p>
      </div>
    </main>
  );
}
