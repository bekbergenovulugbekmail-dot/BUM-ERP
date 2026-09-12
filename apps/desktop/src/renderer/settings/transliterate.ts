/**
 * "Ўзбекча (кирилл)" til sozlamasi: ekrandagi o'zbek lotin matni avtomatik kirillga o'giriladi (matn tugunlari va
 * placeholder/title/aria-label). Kiritish maydonlari, `data-no-translit` va raqam/kodlar (UZS, K01-000123, SKU)
 * o'zgarmaydi. Lotinga qaytishda asl matnlar tiklanadi.
 */
const APOSTROPHE = /[ʻʼ'`‘’]/;
const LETTERS: Record<string, string> = {
  a: "а", b: "б", c: "с", d: "д", e: "е", f: "ф", g: "г", h: "ҳ", i: "и", j: "ж", k: "к", l: "л", m: "м",
  n: "н", o: "о", p: "п", q: "қ", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "х", y: "й", z: "з",
};
const IOTATED: Record<string, string> = { a: "я", o: "ё", u: "ю", e: "е" };

const cased = (text: string, upper: boolean) => (upper ? text.toUpperCase() : text);

function convertWord(word: string): string {
  let result = "";
  for (let i = 0; i < word.length; i++) {
    const char = word[i]!;
    const lower = char.toLowerCase();
    const upper = char !== lower;
    const next = word[i + 1] ?? "";
    const nextLower = next.toLowerCase();
    if ((lower === "o" || lower === "g") && APOSTROPHE.test(next)) {
      result += cased(lower === "o" ? "ў" : "ғ", upper);
      i += 1;
    } else if (lower === "s" && nextLower === "h") {
      result += cased("ш", upper);
      i += 1;
    } else if (lower === "c" && nextLower === "h") {
      result += cased("ч", upper);
      i += 1;
    } else if (lower === "y" && IOTATED[nextLower] && !(nextLower === "o" && APOSTROPHE.test(word[i + 2] ?? ""))) {
      result += cased(IOTATED[nextLower]!, upper);
      i += 1;
    } else if (lower === "e" && i === 0) {
      result += cased("э", upper);
    } else if (APOSTROPHE.test(char)) {
      result += "ъ";
    } else {
      result += LETTERS[lower] ? cased(LETTERS[lower], upper) : char;
    }
  }
  return result;
}

export function toCyrillic(text: string): string {
  return text.replace(/[A-Za-zʻʼ'`‘’]+/g, (word, offset: number, whole: string) => {
    const before = whole[offset - 1] ?? "";
    const after = whole[offset + word.length] ?? "";
    // Kodlar va qisqartmalar: raqam yonida, bosh harflardan iborat (UZS, SKU) yoki faqat tutuq belgisi
    if (/[0-9_-]/.test(before) || /[0-9_]/.test(after) || (word.length > 1 && word === word.toUpperCase()) || !/[A-Za-z]/.test(word)) return word;
    return convertWord(word);
  });
}

type Rendered = { source: string; rendered: string };
const texts = new WeakMap<Text, Rendered>();
const attributes = new WeakMap<Element, Map<string, Rendered>>();
const ATTRIBUTES = ["placeholder", "title", "aria-label"];
let observer: MutationObserver | null = null;
let active: "uz-Latn" | "uz-Cyrl" = "uz-Latn";

const skipped = (element: Element | null) => !!element?.closest("input, textarea, script, style, [data-no-translit]");

function convertText(node: Text) {
  if (skipped(node.parentElement)) return;
  const current = node.nodeValue ?? "";
  const known = texts.get(node);
  if (known && known.rendered === current) return;
  const rendered = toCyrillic(current);
  texts.set(node, { source: current, rendered });
  if (rendered !== current) node.nodeValue = rendered;
}

function convertAttributes(element: Element) {
  if (element.closest("script, style, [data-no-translit]")) return;
  let known = attributes.get(element);
  for (const name of ATTRIBUTES) {
    const current = element.getAttribute(name);
    if (current === null) continue;
    const saved = known?.get(name);
    if (saved && saved.rendered === current) continue;
    const rendered = toCyrillic(current);
    if (!known) attributes.set(element, (known = new Map()));
    known.set(name, { source: current, rendered });
    if (rendered !== current) element.setAttribute(name, rendered);
  }
}

function walk(root: Node, onText: (node: Text) => void, onElement: (element: Element) => void) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node: Node | null = root; node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) onText(node as Text);
    else if (node.nodeType === Node.ELEMENT_NODE) onElement(node as Element);
  }
}

function restoreText(node: Text) {
  const known = texts.get(node);
  if (known && node.nodeValue === known.rendered) node.nodeValue = known.source;
  texts.delete(node);
}

function restoreAttributes(element: Element) {
  const known = attributes.get(element);
  if (!known) return;
  for (const [name, saved] of known) if (element.getAttribute(name) === saved.rendered) element.setAttribute(name, saved.source);
  attributes.delete(element);
}

export function applyScript(language: "uz-Latn" | "uz-Cyrl") {
  if (language === active) return;
  active = language;
  if (language === "uz-Cyrl") {
    walk(document.body, convertText, convertAttributes);
    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") convertText(record.target as Text);
        else if (record.type === "attributes") convertAttributes(record.target as Element);
        else for (const node of record.addedNodes) walk(node, convertText, convertAttributes);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  } else {
    observer?.disconnect();
    observer = null;
    walk(document.body, restoreText, restoreAttributes);
  }
}
