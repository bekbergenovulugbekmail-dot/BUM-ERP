/**
 * Build/dev paytida interfeys matnini kirill rejimiga tayyorlaydi: kodda LOTINDA yozilgan UI matni `__cyr(...)` bilan
 * o'raladi (runtime'da faqat `oz` tilida o'giriladi, aks holda o'zgarishsiz qaytadi — lotin/rus/qozoq rejimi o'zgarmaydi).
 *
 * Nima o'raladi (faqat yozilgan matn — ma'lumot emas):
 *   - JSX matni: `<p>Mahsulot topilmadi</p>`;
 *   - JSX atributlari: title, placeholder, aria-label, alt, label, description va h.k. (satr yoki shablon);
 *   - obyekt xususiyatlari: label, title, description, placeholder, sub, hint, message, text, subtitle...;
 *   - `*_LABELS` / `*Labels` nomli o'zgaruvchidagi barcha satrlar (holat nomlari xaritalari);
 *   - `toast(...)`, `toast.success/error/info/warning/message(...)` birinchi argumenti.
 * Shablon satrda (`Mahsulot: ${name}`) faqat yozilgan qism o'giriladi — `${...}` qiymatlari (ma'lumot) o'zgarmaydi.
 * Solishtirish, kalit, API yo'li kabi boshqa satrlarga tegilmaydi. PDF hujjatlar (`lib/pdf`) — lotinda qoladi.
 *
 * Tahrirlar joyida (qator soni saqlanadi) — dev'dagi xato qatorlari siljimaydi.
 */
import ts from "typescript";
import type { Plugin } from "vite";

const ATTRIBUTES = new Set(["title", "placeholder", "aria-label", "alt", "label", "description", "tooltip", "emptyText", "helperText", "subtitle", "hint", "confirmLabel", "cancelLabel"]);
const PROPERTIES = new Set([
  "label", "title", "description", "placeholder", "sub", "hint", "message", "text", "subtitle", "emptyText", "helper", "caption",
  "tooltip", "confirmLabel", "cancelLabel", "heading", "header",
]);
const LABEL_VARIABLE = /(LABELS?|_TEXTS?|Labels?)$/;
const TOAST_METHODS = new Set(["success", "error", "info", "warning", "message", "loading"]);
/** O'ralmaydigan fayllar: runtime o'zi, i18n, PDF hujjatlar, testlar. */
const EXCLUDE = /(\/src\/lib\/uz-cyrl\.ts|\/src\/i18n\.ts|\/src\/lib\/pdf\/|\/src\/locales\/|\.test\.tsx?$|\/src\/vitest\.setup\.ts)/;

const hasLatinWord = (text: string) => /[A-Za-z]{2,}/.test(text);

type Edit = { start: number; end: number; text: string };

/** JSX matnining ko'rinadigan qiymati (Babel `cleanJSXElementLiteralChild` bilan bir xil). */
function jsxVisibleText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((line, index) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = index;
  });
  let out = "";
  lines.forEach((line, index) => {
    const isFirst = index === 0;
    const isLast = index === lines.length - 1;
    let trimmed = line.replace(/\t/g, " ");
    if (!isFirst) trimmed = trimmed.replace(/^[ ]+/, "");
    if (!isLast) trimmed = trimmed.replace(/[ ]+$/, "");
    if (trimmed) {
      if (index !== lastNonEmpty) trimmed += " ";
      out += trimmed;
    }
  });
  return out;
}

const newlines = (text: string) => (text.match(/\r\n|\n|\r/g) ?? []).length;

export function transformUzCyrl(code: string, fileName: string): string | null {
  if (!/[A-Za-z]{2,}/.test(code)) return null;
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, kind);
  const edits: Edit[] = [];

  /** Satr/shablonni `__cyr("...")` / `__cyrT\`...\`` ga aylantiradi. `jsxAttr` — atribut qiymati `{...}` ichiga olinadi. */
  const wrap = (node: ts.Node, jsxAttr = false) => {
    if (ts.isLiteralTypeNode(node.parent)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!hasLatinWord(node.text)) return;
      const call = `__cyr(${code.slice(node.getStart(source), node.getEnd())})`;
      edits.push({ start: node.getStart(source), end: node.getEnd(), text: jsxAttr ? `{${call}}` : call });
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      if (!parts.some(hasLatinWord)) return;
      edits.push({ start: node.getStart(source), end: node.getStart(source), text: "__cyrT" });
    } else if (ts.isParenthesizedExpression(node)) {
      wrap(node.expression);
    } else if (ts.isConditionalExpression(node)) {
      wrap(node.whenTrue);
      wrap(node.whenFalse);
    } else if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
    ) {
      wrap(node.right);
    }
  };

  /** `*_LABELS` obyektidagi barcha satrlar (ichma-ich ham). */
  const wrapAllStrings = (node: ts.Node) => {
    // Faqat obyekt/massiv literal ichidagi QIYMATLAR: kalit, tur, funksiya chaqiruvi argumenti (`t("key")`) — yo'q
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) wrapAllStrings(property.initializer);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach(wrapAllStrings);
      return;
    }
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
      wrapAllStrings(node.expression);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) wrap(node);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      // JSX matnida bosh bo'shliq ham matn: `getStart()` uni "trivia" deb tashlab ketadi — to'liq boshlanish (`pos`) olinadi
      const raw = code.slice(node.pos, node.end);
      const visible = jsxVisibleText(raw);
      if (hasLatinWord(visible) && !raw.includes("&")) {
        edits.push({ start: node.pos, end: node.end, text: `{__cyr(${JSON.stringify(visible)})${"\n".repeat(newlines(raw))}}` });
      }
      return;
    }
    // JSX ichidagi ifoda: {yuklanmoqda ? "Tayyorlanmoqda…" : "Eksport"}, {shart && "Matn"}, {"Matn"}
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      wrap(node.expression);
    }
    // Pul birligi yozuvi (" so'm") — qayerda bo'lsa ham (solishtirishdan tashqari)
    if (
      ts.isStringLiteral(node) &&
      /^\s*so['ʻ’]m\s*$/.test(node.text) &&
      !(ts.isBinaryExpression(node.parent) && /Equals/.test(ts.SyntaxKind[node.parent.operatorToken.kind]))
    ) {
      wrap(node);
    }
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(source);
      if (ATTRIBUTES.has(name)) {
        if (ts.isStringLiteral(node.initializer)) wrap(node.initializer, true);
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) wrap(node.initializer.expression);
      }
    }
    if (ts.isPropertyAssignment(node) && PROPERTIES.has(node.name.getText(source).replace(/["']/g, ""))) {
      wrap(node.initializer);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && LABEL_VARIABLE.test(node.name.text) && node.initializer) {
      wrapAllStrings(node.initializer);
    }
    if (ts.isCallExpression(node) && node.arguments[0]) {
      const callee = node.expression;
      const isToast =
        (ts.isIdentifier(callee) && callee.text === "toast") ||
        (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "toast" && TOAST_METHODS.has(callee.name.text));
      if (isToast) wrap(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (edits.length === 0) return null;

  // Ichma-ich tahrirlarni olib tashlash (tashqisi qoladi), keyin oxiridan boshlab qo'llash
  edits.sort((a, b) => a.start - b.start || b.end - a.end);
  const flat: Edit[] = [];
  for (const edit of edits) {
    const last = flat[flat.length - 1];
    if (last && edit.start < last.end && edit.start !== edit.end) continue;
    flat.push(edit);
  }
  let out = code;
  for (const edit of flat.reverse()) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  // Import oxirida — qator raqamlari siljimaydi (ES import'lar baribir ko'tariladi)
  return `${out}\nimport { __cyr, __cyrT } from "@/lib/uz-cyrl.ts";\n`;
}

export function uzCyrl(): Plugin {
  return {
    name: "bum-uz-cyrl",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0]!.replace(/\\/g, "/");
      if (!/\/src\/.*\.tsx?$/.test(file) || EXCLUDE.test(file) || file.includes("/node_modules/")) return null;
      const out = transformUzCyrl(code, file);
      return out === null ? null : { code: out, map: null };
    },
  };
}
