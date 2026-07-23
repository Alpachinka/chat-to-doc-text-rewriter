/* ====================================================
   ChatToDoc — app.js  v2.0
   LaTeX/Markdown parsing → MathML (Word-compatible)
   + Equations panel for Alt+= Word fallback
   ==================================================== */

'use strict';

// ─── Wait for KaTeX to load ──────────────────────────────────────────────────
function waitForKatex(cb, tries = 0) {
  if (typeof window.katex !== 'undefined') { cb(); return; }
  if (tries > 50) { console.warn('KaTeX not loaded'); cb(); return; }
  setTimeout(() => waitForKatex(cb, tries + 1), 100);
}

// ─── DOM refs ────────────────────────────────────────────────────────────────
const inputEl       = document.getElementById('input-text');
const previewRender = document.getElementById('preview-rendered');
const previewWord   = document.getElementById('preview-word');
const previewRaw    = document.getElementById('preview-raw');

const statChars  = document.getElementById('stat-chars');
const statWords  = document.getElementById('stat-words');
const statEqs    = document.getElementById('stat-eqs');

const btnCopyWord = document.getElementById('btn-copy-word');
const btnCopyLbl  = document.getElementById('btn-copy-label');
const btnDownload = document.getElementById('btn-download');
const btnExample  = document.getElementById('btn-example');
const btnGuide    = document.getElementById('btn-guide');
const btnClear    = document.getElementById('btn-clear');
const btnPaste    = document.getElementById('btn-paste');
const btnTheme    = document.getElementById('btn-theme');

const settingFont    = document.getElementById('setting-font');
const settingSize    = document.getElementById('setting-size');
const settingSpacing = document.getElementById('setting-spacing');
const settingCols    = document.getElementById('setting-cols');

const tabs        = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

const modalGuide = document.getElementById('modal-guide');
const closeGuide = document.getElementById('close-guide');

const toast     = document.getElementById('toast');
const toastMsg  = document.getElementById('toast-message');
const toastIcon = document.getElementById('toast-icon');

const iconSun  = document.getElementById('icon-sun');
const iconMoon = document.getElementById('icon-moon');

// ─── State ───────────────────────────────────────────────────────────────────
let processedHtml     = '';
let processedWordHtml = '';
let extractedMaths    = [];    // [{raw, display, placeholder}]
let currentTheme      = localStorage.getItem('ctd-theme') || 'dark';
let debounceTimer     = null;

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme);
  waitForKatex(() => {
    setupEventListeners();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  });
});

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
function setupEventListeners() {
  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processInput, 300);
  });

  tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

  btnCopyWord.addEventListener('click', copyForWord);
  btnDownload.addEventListener('click', downloadHtml);
  btnExample.addEventListener('click', loadExample);
  btnClear.addEventListener('click', () => { inputEl.value = ''; processInput(); });
  btnPaste.addEventListener('click', pasteFromClipboard);
  btnTheme.addEventListener('click', toggleTheme);
  btnGuide.addEventListener('click', () => { modalGuide.hidden = false; });
  closeGuide.addEventListener('click', () => { modalGuide.hidden = true; });
  modalGuide.addEventListener('click', e => { if (e.target === modalGuide) modalGuide.hidden = true; });

  [settingFont, settingSize, settingSpacing, settingCols].forEach(el => {
    el.addEventListener('change', updateWordPreview);
  });

  inputEl.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); copyForWord(); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modalGuide.hidden) modalGuide.hidden = true;
  });
}

// ─── THEME ───────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  currentTheme = theme;
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('ctd-theme', theme);
  iconSun.style.display  = theme === 'dark' ? '' : 'none';
  iconMoon.style.display = theme === 'dark' ? 'none' : '';
}
function toggleTheme() { applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); }

// ─── TAB SWITCHING ───────────────────────────────────────────────────────────
function switchTab(tabId) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  tabContents.forEach(c => c.classList.toggle('active', c.id === `content-${tabId}`));
}

// ─── MATH EXTRACTION ─────────────────────────────────────────────────────────
function extractMath(text) {
  const maths = [];
  let idx = 0;

  const patterns = [
    { re: /\$\$([\s\S]*?)\$\$/g,  display: true  },
    { re: /\\\[([\s\S]*?)\\\]/g,  display: true  },
    { re: /\\\(([\s\S]*?)\\\)/g,  display: false },
  ];

  let cleaned = text;

  for (const { re, display } of patterns) {
    cleaned = cleaned.replace(re, (match, inner) => {
      const placeholder = `%%MATH_${idx}_${display ? 'D' : 'I'}%%`;
      maths.push({ placeholder, raw: inner.trim(), display });
      idx++;
      return placeholder;
    });
  }

  cleaned = parseSingleDollar(cleaned, maths, idx);
  return { cleaned, maths };
}

function parseSingleDollar(text, maths, startIdx) {
  let idx = startIdx;
  let result = '';
  let i = 0;

  while (i < text.length) {
    if (text[i] === '\\' && text[i + 1] === '$') { result += '$'; i += 2; continue; }

    if (text[i] === '$') {
      let j = i + 1;
      if (j < text.length && /\s/.test(text[j]) && /\d/.test(text[j])) { result += text[i]; i++; continue; }

      let inner = '';
      let found = false;
      while (j < text.length) {
        if (text[j] === '\\' && text[j + 1] === '$') { inner += '$'; j += 2; continue; }
        if (text[j] === '$') { found = true; break; }
        inner += text[j];
        j++;
      }

      if (found && inner.length > 0 && !isProbablyCurrency(inner)) {
        const placeholder = `%%MATH_${idx}_I%%`;
        maths.push({ placeholder, raw: inner.trim(), display: false });
        idx++;
        result += placeholder;
        i = j + 1;
        continue;
      }
    }

    result += text[i];
    i++;
  }
  return result;
}

function isProbablyCurrency(str) { return /^\d[\d,. ]*$/.test(str.trim()); }

// ─── RENDER MATH — Visual (KaTeX HTML for screen) ───────────────────────────
function renderMathVisual(raw, display) {
  try {
    const html = window.katex.renderToString(raw, {
      displayMode: display,
      output: 'html',
      throwOnError: false,
    });
    return display ? `<div class="katex-display-wrap">${html}</div>` : html;
  } catch (e) {
    return `<span class="math-error">${escapeHtml(raw)}</span>`;
  }
}

// ─── RENDER MATH — Word MathML (clean, no annotation) ───────────────────────
/**
 * CRITICAL: KaTeX includes <annotation encoding="application/x-tex">
 * inside a <semantics> wrapper. Word reads this annotation as PLAIN TEXT
 * next to the equation, causing the double-output garble.
 * We use DOMParser to safely remove it before copying to clipboard.
 */
function renderMathMathML(raw, display) {
  try {
    const mlRaw = window.katex.renderToString(raw, {
      displayMode: display,
      output: 'mathml',
      throwOnError: false,
    });

    // Parse as HTML so we can safely manipulate the DOM
    const doc = new DOMParser().parseFromString(mlRaw, 'text/html');

    // 1. Remove ALL <annotation> elements — they hold raw LaTeX that Word prints as text
    doc.querySelectorAll('annotation').forEach(a => a.remove());

    // 2. Unwrap <semantics> if it now has only one meaningful child
    doc.querySelectorAll('semantics').forEach(sem => {
      const kids = [...sem.children];
      if (kids.length === 1) {
        sem.replaceWith(kids[0]);
      }
    });

    // 3. Get the <math> element and set required attributes
    const math = doc.querySelector('math');
    if (!math) return `<span>${escapeHtml(raw)}</span>`;

    // xmlns MUST be present — without it Word treats <math> as unknown HTML tag
    math.setAttribute('xmlns', 'http://www.w3.org/1998/Math/MathML');

    // display="block" centers the equation in Word
    if (display) math.setAttribute('display', 'block');

    // Serialize the cleaned math element back to string
    const serial = new XMLSerializer();
    let ml = serial.serializeToString(math);

    // XMLSerializer sometimes adds extra namespace declarations; clean them up
    ml = ml.replace(/ xmlns:xhtml="[^"]*"/g, '');

    // Wrap display equations in a centered paragraph
    if (display) {
      return `<p style="text-align:center;margin:6pt 0;">${ml}</p>`;
    }
    return ml;

  } catch (e) {
    console.error('MathML render error:', e);
    return `<span>${escapeHtml(raw)}</span>`;
  }
}

// ─── PROCESS INPUT ───────────────────────────────────────────────────────────
function processInput() {
  const raw = inputEl.value;
  updateStats(raw);

  if (!raw.trim()) { setEmptyPreviews(); btnCopyWord.disabled = true; btnDownload.disabled = true; return; }

  if (typeof window.katex === 'undefined') { showToast('KaTeX ще завантажується…', 'info'); return; }

  const { cleaned, maths } = extractMath(raw);
  extractedMaths = maths;

  // Visual HTML for screen
  let visualHtml = parseMarkdown(cleaned);
  visualHtml = reinjectMath(visualHtml, maths, 'visual');

  // Word HTML with clean MathML (no annotations)
  let wordHtml = parseMarkdown(cleaned, true);
  wordHtml = reinjectMath(wordHtml, maths, 'mathml');

  processedHtml     = visualHtml;
  processedWordHtml = wordHtml;

  previewRender.innerHTML = visualHtml;
  updateWordPreview();
  previewRaw.textContent = buildWordClipboardHtml(processedWordHtml);

  // Render equations panel
  renderEquationsPanel(maths);

  btnCopyWord.disabled = false;
  btnDownload.disabled = false;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function reinjectMath(html, maths, mode) {
  let out = html;
  for (const { placeholder, raw, display } of maths) {
    const rendered = mode === 'mathml'
      ? renderMathMathML(raw, display)
      : renderMathVisual(raw, display);
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\%]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), rendered);
  }
  return out;
}

// ─── MARKDOWN PARSER ─────────────────────────────────────────────────────────
function parseMarkdown(text, forWord = false) {
  if (typeof window.marked === 'undefined') return `<p>${escapeHtml(text)}</p>`;

  window.marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
  let html = window.marked.parse(text);

  if (forWord) {
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  }
  return html;
}

// ─── WORD PREVIEW ────────────────────────────────────────────────────────────
function updateWordPreview() {
  if (!processedWordHtml) return;
  previewWord.innerHTML = `
    <div style="font-family:${settingFont.value}, sans-serif;
                font-size:${settingSize.value};
                line-height:${settingSpacing.value};
                color:#000; max-width:100%;">
      ${processedWordHtml}
    </div>`;
}

// ─── EQUATIONS PANEL ─────────────────────────────────────────────────────────
/**
 * Renders individual equation cards below the main layout.
 * Each card shows the rendered equation + a "Copy LaTeX for Word" button.
 * Users can paste each LaTeX into Word's Alt+= equation editor (guaranteed to work).
 */
function renderEquationsPanel(maths) {
  let panel = document.getElementById('equations-panel');

  if (!maths.length) {
    if (panel) panel.remove();
    return;
  }

  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'equations-panel';
    panel.className = 'equations-panel';
    document.querySelector('.main-layout').after(panel);
  }

  panel.innerHTML = `
    <div class="eq-panel-header">
      <div class="eq-panel-title">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        <span>Формули для редактора рівнянь Word (<kbd>Alt</kbd>+<kbd>=</kbd>)</span>
      </div>
      <div class="eq-panel-hint">
        Якщо вставка Ctrl+V не дала правильного результату — скопіюйте LaTeX та вставте його у полі рівняння Word
      </div>
    </div>
    <div class="eq-cards">
      ${maths.map((m, i) => `
        <div class="eq-card">
          <div class="eq-card-preview" id="eq-preview-${i}"></div>
          <div class="eq-card-footer">
            <div class="eq-card-type">${m.display ? 'Блочна формула' : 'Рядкова формула'}</div>
            <div class="eq-card-actions">
              <button class="btn-eq-copy" onclick="copyEqLatex(${i})" id="eq-btn-${i}">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="2">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                </svg>
                Скопіювати LaTeX
              </button>
            </div>
          </div>
          <pre class="eq-latex-source">${escapeHtml(m.raw)}</pre>
        </div>
      `).join('')}
    </div>`;

  // Render equations visually in the cards
  maths.forEach((m, i) => {
    const el = document.getElementById(`eq-preview-${i}`);
    if (!el) return;
    try {
      window.katex.render(m.raw, el, {
        displayMode: true,
        throwOnError: false,
        output: 'html',
      });
    } catch(e) {
      el.textContent = m.raw;
    }
  });
}

// Global handler for equation copy buttons
window.copyEqLatex = async function(idx) {
  if (!extractedMaths[idx]) return;
  const latex = extractedMaths[idx].raw;
  const btn   = document.getElementById(`eq-btn-${idx}`);

  try {
    await navigator.clipboard.writeText(latex);
    if (btn) { btn.textContent = '✓ Скопійовано!'; setTimeout(() => { btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Скопіювати LaTeX`; }, 2000); }
    showToast('LaTeX скопійовано! Вставте у Word: Alt+= → вставити → Enter', 'success');
  } catch(e) {
    showToast('Помилка. Скопіюйте LaTeX вручну з поля нижче.', 'error');
  }
};

// ─── CLIPBOARD HELPERS ───────────────────────────────────────────────────────
/**
 * Builds Word-compatible HTML with proper Office namespace declarations.
 * These xmlns attributes signal to Word that the HTML was generated by
 * an Office-compatible source and it should process <math> elements.
 */
function buildWordClipboardHtml(bodyHtml) {
  const font    = settingFont.value;
  const size    = settingSize.value;
  const spacing = settingSpacing.value;
  const width   = settingCols.value === 'auto' ? '100%' : settingCols.value;

  return `<html
  xmlns="http://www.w3.org/1999/xhtml"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<meta name="ProgId" content="Word.Document"/>
<meta name="Generator" content="Microsoft Word 15"/>
<style type="text/css">
body, p, div, li, td, th {
  font-family: ${font}, Arial, sans-serif;
  font-size: ${size};
  line-height: ${spacing};
  color: #000000;
}
table { border-collapse: collapse; width: ${width}; }
td, th { border: 1px solid #000000; padding: 4pt 8pt; }
th { background-color: #f2f2f2; font-weight: bold; }
h1 { font-size: 1.8em; } h2 { font-size: 1.4em; } h3 { font-size: 1.2em; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

async function copyForWord() {
  if (!processedWordHtml) return;

  const clipHtml  = buildWordClipboardHtml(processedWordHtml);
  const plainText = inputEl.value;

  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html':  new Blob([clipHtml],  { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      })]);
      showCopySuccess();
      return;
    } catch (err) {
      console.warn('Clipboard API failed:', err);
    }
  }

  // Legacy fallback
  try {
    const el = document.createElement('div');
    el.innerHTML = clipHtml;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
    document.body.appendChild(el);
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    document.body.removeChild(el);
    showCopySuccess();
  } catch (err2) {
    showToast('Помилка. Спробуйте кнопку "HTML файл".', 'error');
  }
}

function showCopySuccess() {
  btnCopyLbl.textContent = 'Скопійовано! ✓';
  showToast('Скопійовано! Вставте у Word (Ctrl+V). Формули не відображаються? — Використайте панель "Формули для Word" нижче.', 'success');
  setTimeout(() => { btnCopyLbl.textContent = 'Скопіювати для MS Word'; }, 3000);
}

// ─── DOWNLOAD HTML ───────────────────────────────────────────────────────────
function downloadHtml() {
  if (!processedWordHtml) return;
  const blob = new Blob([buildWordClipboardHtml(processedWordHtml)], { type: 'text/html; charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'document.html' });
  a.click();
  URL.revokeObjectURL(url);
  showToast('HTML-файл завантажено', 'success');
}

// ─── PASTE FROM CLIPBOARD ────────────────────────────────────────────────────
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    inputEl.value = text;
    processInput();
  } catch {
    showToast('Немає доступу до буферу. Вставте вручну (Ctrl+V).', 'error');
  }
}

// ─── EXAMPLE ─────────────────────────────────────────────────────────────────
function loadExample() {
  inputEl.value = `## Транспортна задача

Мета — мінімізувати **загальні витрати на перевезення**:

$$Z = \\sum_{i=1}^{m} \\sum_{j=1}^{n} \\left( n_{ij} \\cdot t_{ij} \\cdot C_{ij} \\right) \\tag{5.2}$$

де:
- $n_{ij}$ — кількість рейсів на маршруті $i \\to j$
- $t_{ij}$ — тривалість рейсу (год)
- $C_{ij}$ — вартість рейсо-часу (грн/год)

### Обмеження

$$\\sum_{j=1}^{n} n_{ij} \\leq S_i, \\quad i = 1, \\ldots, m$$

$$\\text{Penalty}_{\\text{Disk}} = \\min\\!\\left(20,\\, \\left\\lfloor (10.0 - \\text{FreeSpace}_{\\text{GB}}) \\times 2 \\right\\rfloor\\right)$$

### Таблиця вхідних даних

| Маршрут | $n_{ij}$ | $t_{ij}$ (год) | $C_{ij}$ (грн/год) |
|---------|----------|----------------|---------------------|
| A → B   | 5        | 2.5            | 120                 |
| A → C   | 3        | 4.0            | 95                  |

Ефективність: $\\eta = \\frac{Q_{\\text{корисний}}}{Z}$`;

  processInput();
  showToast('Приклад завантажено!', 'success');
}

// ─── STATS ───────────────────────────────────────────────────────────────────
function updateStats(text) {
  statChars.textContent = text.length;
  statWords.textContent = text.trim() ? text.trim().split(/\s+/).length : 0;
  const eqs =
    (text.match(/\$\$[\s\S]*?\$\$/g) || []).length +
    (text.match(/\\\[[\s\S]*?\\\]/g) || []).length +
    (text.match(/\\\([\s\S]*?\\\)/g) || []).length +
    (text.match(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g) || []).length;
  statEqs.textContent = eqs;
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────
function setEmptyPreviews() {
  const ph = msg => `<div class="preview-placeholder"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m9 18 6-6-6-6"/></svg><p>${msg}</p></div>`;
  previewRender.innerHTML = ph('Вставте текст зліва');
  previewWord.innerHTML   = ph('Тут буде вигляд у Word');
  previewRaw.textContent  = 'HTML-код з\'явиться тут...';
  processedHtml = processedWordHtml = '';
  extractedMaths = [];
  const panel = document.getElementById('equations-panel');
  if (panel) panel.remove();
  updateStats('');
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, type = 'success') {
  toastMsg.textContent = message;
  toast.className = 'toast' + (type === 'error' ? ' error' : '');
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
