/**
 * 各 shadow root UI（側欄、toast）的宿主專屬樣式。
 *
 * 不經 `createShadowRootUi` 的 `css` 選項傳入：WXT 會把它和整份 content.css 拼成同一個 `<style>`，
 * 文字一不同，Blink 就無法共用解析結果，每個 UI 都各自解析並保留一份 ~100KB 的樣式表。
 * 另外放進一個小 `<style>`，WXT 注入的主樣式在各 shadow root 就完全相同，只會解析一次。
 *
 * 這個 `<style>` 排在 WXT 主樣式之後，`!important` 宣告會蓋過 WXT 的 `:host { all: initial !important }`。
 */
export function appendShadowHostStyle(shadow: ShadowRoot, css: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.setAttribute('data-poexd-host-style', '');
  style.textContent = css;
  shadow.appendChild(style);
  return style;
}
