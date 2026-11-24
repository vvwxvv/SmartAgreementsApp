import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stripDuplicateTitle } from "@/agreement/markdown";
import { numberHeadings, headingSlug } from "@/lib/contractSections";

// A clause starts with 1.1 / 2.3.4 and then a separator. Used only to add a
// hanging-indent class; the text itself is untouched.
const CLAUSE = /^\s*\d+(?:\.\d+)+[\s、.．]/;
// Leading clause number, e.g. "1.1" / "8.7.2" — underlined in print.
const CLAUSE_NO = /^(\d{1,2}(?:\.\d{1,2}){1,2})(?=[\s\u4e00-\u9fa5])/;

// "表 1 · 提交文件清单" / "Figure 2 · ..." — treated as a table/figure caption:
// greyer, tighter, and kept on the same page as what follows.
const CAPTION = /^\s*(表|图|附表|附图|Table|Figure|Fig\.)\s*[\dA-Z一二三四五六七八九十]/i;

const FEE_TABLE = /金额|价款|费用|Amount|Price|Fee|Total/i;

function textOf(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && node.props) return textOf(node.props.children);
  return "";
}

function ClauseParagraph({ children }) {
  const text = textOf(children);
  if (CAPTION.test(text)) return <p className="pd-caption">{children}</p>;

  const kids = Array.isArray(children) ? children.filter((c) => c !== "\n") : [children];

  // A paragraph whose only child is **bold** is a sub-heading, not body text.
  if (kids.length === 1 && kids[0] && kids[0].type === "strong") {
    return <p className="pd-subhead">{kids[0].props?.children}</p>;
  }

  // Underline just the leading clause number, the way a printed contract does.
  const m = typeof kids[0] === "string" ? CLAUSE_NO.exec(kids[0]) : null;
  if (m) {
    return (
      <p className="ag-clause">
        <span className="ag-clause-no">{m[1]}</span>
        {kids[0].slice(m[1].length)}
      </p>
    );
  }

  return <p className={CLAUSE.test(text) ? "ag-clause" : undefined}>{children}</p>;
}

/** Tables get a scroll container so narrow screens never clip a column. */
function ClauseTable({ children }) {
  const text = textOf(children);
  const kind = FEE_TABLE.test(text) ? "fee" : "data";
  // A key/value table (e.g. 免费维护期 | …) has no real header. Markdown forces
  // one, so the editor writes an empty first row — hide that row instead of
  // letting the first data pair look like column titles.
  const kids = Array.isArray(children) ? children : [children];
  const thead = kids.find((c) => c && c.type === "thead");
  const headerText = thead ? textOf(thead.props?.children).replace(/\s/g, "") : "";
  const bare = Boolean(thead) && headerText === "";
  return (
    <div className="pd-table-wrap">
      <table data-kind={kind} className={bare ? "pd-table--bare" : undefined}>{children}</table>
    </div>
  );
}

function ClausePre({ children }) {
  return (
    <div className="pd-code-wrap">
      <pre>{children}</pre>
    </div>
  );
}

const heading = (Tag) =>
  function ClauseHeading({ children }) {
    return <Tag id={headingSlug(textOf(children))}>{children}</Tag>;
  };

export default function MarkdownBody({ markdown, title }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ClauseParagraph,
        table: ClauseTable,
        pre: ClausePre,
        h2: heading("h2"),
        h3: heading("h3"),
        h4: heading("h4"),
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        ),
      }}
    >
      {numberHeadings(stripDuplicateTitle(markdown, title))}
    </ReactMarkdown>
  );
}
