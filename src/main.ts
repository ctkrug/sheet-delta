import "./style.css";

const WORDMARK_GLYPH = `
  <svg class="wordmark__glyph" viewBox="0 0 64 64" aria-hidden="true">
    <path d="M32 14 L50 46 L14 46 Z" fill="none" stroke="#1E5AA8" stroke-width="5" stroke-linejoin="round" />
  </svg>
`;

export function render(root: HTMLElement): void {
  root.innerHTML = `
    <header class="topbar">
      <div class="wordmark">
        ${WORDMARK_GLYPH}
        Sheet Delta
      </div>
      <span class="tagline">Cell-level diffs for CSV &amp; Excel — nothing leaves your browser</span>
    </header>
    <main>
      <div class="hero">
        <div class="dropzones">
          <div class="dropzone" role="button" tabindex="0" aria-label="Choose the before file">
            <span class="dropzone__label">Before</span>
            <span class="dropzone__hint">Drop a .csv or .xlsx file, or click to browse</span>
          </div>
          <div class="dropzone" role="button" tabindex="0" aria-label="Choose the after file">
            <span class="dropzone__label">After</span>
            <span class="dropzone__hint">Drop a .csv or .xlsx file, or click to browse</span>
          </div>
        </div>
      </div>
    </main>
    <footer>Sheet Delta — open source, MIT licensed</footer>
  `;
}

const root = document.getElementById("app");
if (root) {
  render(root);
}
