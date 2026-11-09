/**
 * 不經過 HTML 解析的 DOM 建構工具。
 *
 * 用來取代 `innerHTML`：避免把動態文字當成 HTML 解析（XSS），
 * 也讓 Firefox AMO 的 linter 不產生 UNSAFE_VAR_ASSIGNMENT 警告。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SvgIconSpec {
  /** `<svg>` 根節點屬性，例如 viewBox、width、stroke */
  readonly attrs: Readonly<Record<string, string>>;
  /** 每個 `<path>` 的 `d` 屬性 */
  readonly paths: readonly string[];
  /** 套用到每個 `<path>` 的額外屬性 */
  readonly pathAttrs?: Readonly<Record<string, string>>;
}

export function createSvgIcon(spec: SvgIconSpec, doc: Document = document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [name, value] of Object.entries(spec.attrs)) {
    svg.setAttribute(name, value);
  }
  for (const d of spec.paths) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    for (const [name, value] of Object.entries(spec.pathAttrs ?? {})) {
      path.setAttribute(name, value);
    }
    svg.appendChild(path);
  }
  return svg;
}

/** 在 parent 尾端加入「標籤文字 + 帶 class 的數值 span」 */
export function appendLabeledValue(
  parent: Element,
  label: string,
  value: string,
  valueClass?: string,
  doc: Document = document,
): void {
  parent.appendChild(doc.createTextNode(label));
  const valueEl = doc.createElement('span');
  if (valueClass) valueEl.className = valueClass;
  valueEl.textContent = value;
  parent.appendChild(valueEl);
}

/** 清空 parent 後寫入「標籤文字 + 數值 span」 */
export function setLabeledValue(
  parent: Element,
  label: string,
  value: string,
  valueClass?: string,
  doc: Document = document,
): void {
  parent.replaceChildren();
  appendLabeledValue(parent, label, value, valueClass, doc);
}
