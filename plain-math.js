/* ====================================================
   ChatToDoc — plain-math.js
   Automatic detection & AST-based conversion of
   plain-text / Unicode symbolic formulas into LaTeX
   ==================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlainMath = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ─── SYMBOL TABLES ─────────────────────────────────────────────────────────
  const GREEK_MAP = {
    'α': '\\alpha',   'β': '\\beta',    'γ': '\\gamma',   'δ': '\\delta',
    'ε': '\\varepsilon', 'ϵ': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta',
    'θ': '\\theta',   'ϑ': '\\vartheta', 'ι': '\\iota',   'κ': '\\kappa',
    'λ': '\\lambda',  'μ': '\\mu',      'ν': '\\nu',      'ξ': '\\xi',
    'π': '\\pi',      'ϖ': '\\varpi',   'ρ': '\\rho',     'ϱ': '\\varrho',
    'σ': '\\sigma',   'ς': '\\varsigma','τ': '\\tau',     'υ': '\\upsilon',
    'φ': '\\varphi',  'ϕ': '\\phi',     'χ': '\\chi',     'ψ': '\\psi',
    'ω': '\\omega',
    'Γ': '\\Gamma',   'Δ': '\\Delta',   'Θ': '\\Theta',   'Λ': '\\Lambda',
    'Ξ': '\\Xi',      'Π': '\\Pi',      'Σ': '\\Sigma',   'Υ': '\\Upsilon',
    'Φ': '\\Phi',     'Ψ': '\\Psi',     'Ω': '\\Omega',
  };

  const SUP_MAP = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
    'ⁿ': 'n', 'ⁱ': 'i', 'ˣ': 'x', 'ʸ': 'y', 'ᵃ': 'a',
    'ᵇ': 'b', 'ᶜ': 'c', 'ᵈ': 'd', 'ᵉ': 'e', 'ᵏ': 'k',
    'ᵐ': 'm', 'ᵖ': 'p', 'ʳ': 'r', 'ˢ': 's', 'ᵗ': 't',
  };

  const SUB_MAP = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
    'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h',
    'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₚ': 'p',
    'ₛ': 's', 'ₜ': 't', 'ᵢ': 'i', 'ⱼ': 'j', 'ᵣ': 'r',
    'ᵤ': 'u', 'ᵥ': 'v',
  };

  const VULGAR_FRACS = {
    '½': ['1', '2'], '⅓': ['1', '3'], '⅔': ['2', '3'],
    '¼': ['1', '4'], '¾': ['3', '4'], '⅕': ['1', '5'],
    '⅖': ['2', '5'], '⅗': ['3', '5'], '⅘': ['4', '5'],
    '⅙': ['1', '6'], '⅚': ['5', '6'], '⅛': ['1', '8'],
    '⅜': ['3', '8'], '⅝': ['5', '8'], '⅞': ['7', '8'],
  };

  const REL_MAP = {
    '=': '=',   '≈': '\\approx', '≤': '\\le',  '≥': '\\ge',
    '≠': '\\neq', '≡': '\\equiv', '∝': '\\propto',
    '<=': '\\le', '>=': '\\ge', '!=': '\\neq', '~=': '\\approx',
    '<': '<',   '>': '>',
    '→': '\\to', '->': '\\to', '⇒': '\\Rightarrow', '=>': '\\Rightarrow',
    '⇔': '\\Leftrightarrow', '<=>': '\\Leftrightarrow',
    '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '⊆': '\\subseteq',
  };

  const MATH_FUNCS = new Set([
    'arcsin', 'arccos', 'arctan', 'arctg', 'arcctg',
    'sinh', 'cosh', 'tanh', 'coth',
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'tg', 'ctg', 'sh', 'ch', 'th', 'cth',
    'sqrt', 'cbrt', 'abs',
    'log10', 'log2', 'log', 'ln', 'lg', 'exp',
    'lim', 'max', 'min', 'det', 'deg', 'gcd', 'mod', 'sup', 'inf',
  ]);

  const KATEX_NATIVE_FUNCS = new Set([
    'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth',
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'det', 'deg', 'gcd', 'sup', 'inf',
  ]);

  // Sorted longest-first for greedy matching
  const FUNC_LIST = Array.from(MATH_FUNCS).sort((a, b) => b.length - a.length);

  // Common English words that must NOT be parsed as implicit-multiplication Latin variables
  const ENGLISH_STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'for',
    'from', 'get', 'go', 'had', 'has', 'have', 'he', 'her', 'his', 'how', 'if',
    'in', 'into', 'is', 'it', 'its', 'may', 'me', 'my', 'no', 'not', 'now', 'of',
    'on', 'one', 'only', 'or', 'our', 'out', 'per', 'put', 'run', 'say', 'see',
    'set', 'she', 'so', 'sum', 'than', 'that', 'the', 'then', 'this', 'to', 'too',
    'two', 'up', 'us', 'use', 'via', 'was', 'way', 'we', 'who', 'why', 'will',
    'with', 'you', 'your', 'word', 'html', 'text', 'code', 'file', 'copy', 'ctrl',
    'alt', 'shift', 'enter', 'tab', 'esc', 'http', 'https', 'www', 'com', 'org',
    'net', 'pdf', 'doc', 'docx', 'png', 'jpg', 'svg', 'css', 'json', 'api', 'url',
    'true', 'false', 'null', 'var', 'let', 'const', 'end', 'new', 'old', 'all',
  ]);

  // Known Cyrillic physical/SI units (base + SI prefixes)
  const CYR_UNITS = new Set([
    'км', 'м', 'дм', 'см', 'мм', 'мкм', 'нм', 'пм', 'га', 'ар',
    'т', 'ц', 'кг', 'г', 'мг', 'мкг',
    'с', 'мс', 'мкс', 'нс', 'пс', 'хв', 'мин', 'год', 'ч', 'діб', 'сут',
    'Н', 'кН', 'МН', 'ГН', 'мН',
    'Дж', 'кДж', 'МДж', 'ГДж', 'ТДж', 'мДж', 'мкДж', 'кал', 'ккал', 'Мкал',
    'еВ', 'эВ', 'кеВ', 'МеВ', 'ГеВ', 'кэВ', 'МэВ', 'ГэВ',
    'Вт', 'кВт', 'МВт', 'ГВт', 'ТВт', 'мВт', 'мкВт', 'нВт',
    'ВА', 'кВА', 'МВА', 'ГВА', 'вар', 'Вар', 'квар', 'кВар', 'Мвар', 'МВар',
    'В', 'кВ', 'МВ', 'ГВ', 'мВ', 'мкВ', 'нВ',
    'А', 'кА', 'МА', 'мА', 'мкА', 'нА',
    'Ом', 'кОм', 'МОм', 'ГОм', 'мОм', 'мкОм', 'См', 'мСм', 'мкСм',
    'Гц', 'кГц', 'МГц', 'ГГц', 'ТГц',
    'Па', 'кПа', 'МПа', 'ГПа', 'мПа', 'бар', 'мбар', 'атм',
    'К', 'град', 'рад', 'мрад', 'ср',
    'моль', 'ммоль', 'кмоль', 'мкмоль',
    'л', 'мл', 'мкл', 'дл', 'кл',
    'Кл', 'кКл', 'мКл', 'мкКл', 'нКл', 'пКл',
    'Ф', 'мФ', 'мкФ', 'нФ', 'пФ',
    'Гн', 'мГн', 'мкГн', 'нГн',
    'Тл', 'мТл', 'мкТл', 'Вб', 'мВб', 'мкВб',
    'лм', 'клм', 'Млм', 'млм', 'лк', 'клк', 'Млк', 'млк', 'кд', 'ккд', 'мкд',
    'Бк', 'кБк', 'МБк', 'ГБк', 'Гр', 'мГр', 'Зв', 'мЗв', 'мкЗв',
    'дБ', 'об', 'шт', 'грн', 'біт', 'кбіт', 'Мбіт', 'Гбіт', 'байт', 'КБ', 'МБ', 'ГБ', 'ТБ',
  ]);

  // Multi-letter Latin units (safe after space + number)
  const LAT_MULTI_UNITS = new Set([
    'km', 'dm', 'cm', 'mm', 'nm', 'um', 'pm', 'ha',
    'kg', 'mg', 'ug',
    'ms', 'us', 'ns', 'ps', 'min', 'hr',
    'kN', 'MN', 'GN', 'mN', 'kJ', 'MJ', 'GJ', 'mJ', 'uJ',
    'eV', 'keV', 'MeV', 'GeV', 'cal', 'kcal', 'Mcal',
    'kW', 'MW', 'GW', 'TW', 'mW', 'uW', 'kVA', 'MVA', 'VA', 'var', 'kvar', 'Mvar',
    'kV', 'MV', 'mV', 'uV', 'mA', 'uA', 'nA', 'kA',
    'Ohm', 'kOhm', 'MOhm', 'GOhm', 'mOhm',
    'Hz', 'kHz', 'MHz', 'GHz', 'THz',
    'Pa', 'kPa', 'MPa', 'GPa', 'bar', 'mbar', 'atm',
    'rad', 'mrad', 'deg', 'mol', 'mmol', 'kmol', 'mL', 'uL', 'dL',
    'dB', 'rpm', 'Wb', 'mWb', 'lm', 'klm', 'Mlm', 'lx', 'klx', 'cd', 'kcd',
    'mF', 'uF', 'nF', 'pF', 'mH', 'uH', 'nH', 'mT', 'uT', 'mC', 'uC', 'nC',
    'KB', 'MB', 'GB', 'TB', 'kbps', 'Mbps', 'Gbps',
  ]);

  // Single-letter Latin units (only safe after space + number when followed by /, sup, or end/rel/punct)
  const LAT_SINGLE_UNITS = new Set([
    'm', 'g', 's', 'h', 't', 'N', 'J', 'W', 'V', 'A', 'K', 'L', 'C', 'F', 'H', 'T',
  ]);

  const EN_SUBSCRIPTS = /^(max|min|avg|eff|tot|nom|crit|ext|int|out|in)$/;

  const CYR_HOMOGLYPHS = {
    'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H',
    'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'І': 'I',
    'Ф': '\\Phi',
  };

  const CYR_LOWER_RE = /[а-яіїєґ]/;

  const CYR_CHAR_RE = /[а-яА-ЯіІїЇєЄґҐ]/;
  const LAT_CHAR_RE = /[A-Za-z]/;
  const DIGIT_RE    = /[0-9]/;
  const SPACE_RE    = /[ \t\u00A0\u202F]/;

  function isCyr(ch)   { return ch ? CYR_CHAR_RE.test(ch) : false; }
  function isLat(ch)   { return ch ? LAT_CHAR_RE.test(ch) : false; }
  function isDigit(ch) { return ch ? DIGIT_RE.test(ch) : false; }
  function isSpace(ch) { return ch ? SPACE_RE.test(ch) : false; }
  function isGreek(ch) { return ch ? Object.prototype.hasOwnProperty.call(GREEK_MAP, ch) : false; }
  function isSup(ch)   { return ch ? Object.prototype.hasOwnProperty.call(SUP_MAP, ch) : false; }
  function isSub(ch)   { return ch ? Object.prototype.hasOwnProperty.call(SUB_MAP, ch) : false; }

  // ─── LEXER (TOKENIZER) ─────────────────────────────────────────────────────
  function tokenize(input) {
    const tokens = [];
    const n = input.length;
    let i = 0;

    while (i < n) {
      let hadSpace = false;
      while (i < n && isSpace(input[i])) { hadSpace = true; i++; }
      if (i >= n) break;

      const start = i;
      const ch = input[i];
      const prev = tokens.length ? tokens[tokens.length - 1] : null;

      // 1. Multi-char relation operators
      const two = input.slice(i, i + 2);
      const three = input.slice(i, i + 3);
      if (three === '<=>') {
        tokens.push({ type: 'REL', val: '<=>', latex: REL_MAP['<=>'], start, end: i + 3, hadSpace });
        i += 3; continue;
      }
      if (two === '<=' || two === '>=' || two === '!=' || two === '~=' || two === '->' || two === '=>') {
        tokens.push({ type: 'REL', val: two, latex: REL_MAP[two], start, end: i + 2, hadSpace });
        i += 2; continue;
      }

      // 2. Single-char relations
      if (Object.prototype.hasOwnProperty.call(REL_MAP, ch)) {
        tokens.push({ type: 'REL', val: ch, latex: REL_MAP[ch], start, end: i + 1, hadSpace });
        i++; continue;
      }

      // 3. Infinity
      if (ch === '∞') {
        tokens.push({ type: 'IDENT', val: '∞', latex: '\\infty', start, end: i + 1, hadSpace });
        i++; continue;
      }

      // 4. Roots
      if (ch === '√' || ch === '∛' || ch === '∜') {
        const deg = ch === '∛' ? '3' : (ch === '∜' ? '4' : null);
        tokens.push({ type: 'ROOT', val: ch, deg, start, end: i + 1, hadSpace });
        i++; continue;
      }

      // 5. Big operators
      if (ch === '∑' || ch === '∏' || ch === '∫') {
        const ltx = ch === '∑' ? '\\sum' : (ch === '∏' ? '\\prod' : '\\int');
        tokens.push({ type: 'BIGOP', val: ch, latex: ltx, start, end: i + 1, hadSpace });
        i++; continue;
      }

      // 6. Degree (°C, °F, °)
      if (ch === '°') {
        if (i + 1 < n && (input[i + 1] === 'C' || input[i + 1] === 'F' || input[i + 1] === 'С')) {
          const scale = input[i + 1] === 'С' ? 'C' : input[i + 1];
          tokens.push({ type: 'DEGREE', val: '°' + scale, scale, start, end: i + 2, hadSpace });
          i += 2; continue;
        }
        tokens.push({ type: 'DEGREE', val: '°', scale: null, start, end: i + 1, hadSpace });
        i++; continue;
      }

      // 7. Percent
      if (ch === '%') {
        tokens.push({ type: 'PERCENT', val: '%', start, end: i + 1, hadSpace });
        i++; continue;
      }

      // 8. Vulgar fractions
      if (Object.prototype.hasOwnProperty.call(VULGAR_FRACS, ch)) {
        const [num, den] = VULGAR_FRACS[ch];
        tokens.push({ type: 'VFRAC', val: ch, num, den, start, end: i + 1, hadSpace });
        i++; continue;
      }

      // 9. Unicode superscript run
      if (isSup(ch)) {
        let s = '';
        while (i < n && isSup(input[i])) { s += SUP_MAP[input[i]]; i++; }
        tokens.push({ type: 'SUP', val: s, start, end: i, hadSpace });
        continue;
      }

      // 10. Unicode subscript run (allow comma between subscripts like x₁,₂)
      if (isSub(ch)) {
        let s = '';
        while (i < n) {
          if (isSub(input[i])) { s += SUB_MAP[input[i]]; i++; }
          else if (input[i] === ',' && i + 1 < n && isSub(input[i + 1])) { s += ','; i++; }
          else break;
        }
        tokens.push({ type: 'SUB', val: s, start, end: i, hadSpace });
        continue;
      }

      // 11. Operators
      if (ch === '+' || ch === '-' || ch === '−' || ch === '–' || ch === '±' || ch === '∓') {
        const norm = (ch === '−' || ch === '–') ? '-' : ch;
        const latex = norm === '±' ? '\\pm' : (norm === '∓' ? '\\mp' : norm);
        tokens.push({ type: 'ADD', val: norm, latex, start, end: i + 1, hadSpace });
        i++; continue;
      }
      if (ch === '·' || ch === '⋅' || ch === '•' || ch === '*') {
        tokens.push({ type: 'MUL', val: ch, latex: '\\cdot', start, end: i + 1, hadSpace });
        i++; continue;
      }
      if (ch === '×') {
        tokens.push({ type: 'MUL', val: ch, latex: '\\times', start, end: i + 1, hadSpace });
        i++; continue;
      }
      if (ch === '/') {
        tokens.push({ type: 'DIV', val: '/', start, end: i + 1, hadSpace });
        i++; continue;
      }
      if (ch === '÷') {
        tokens.push({ type: 'MUL', val: '÷', latex: '\\div', start, end: i + 1, hadSpace });
        i++; continue;
      }
      if (ch === '^') {
        tokens.push({ type: 'POW', val: '^', start, end: i + 1, hadSpace });
        i++; continue;
      }
      if (ch === '_') {
        tokens.push({ type: 'SUB_OP', val: '_', start, end: i + 1, hadSpace });
        i++; continue;
      }
      if (ch === '!') {
        tokens.push({ type: 'FACT', val: '!', start, end: i + 1, hadSpace });
        i++; continue;
      }
      if (ch === "'" || ch === '′' || ch === '″') {
        const cnt = ch === '″' ? 2 : 1;
        tokens.push({ type: 'PRIME', val: "'".repeat(cnt), start, end: i + 1, hadSpace });
        i++; continue;
      }

      // 12. Delimiters & comma
      if (ch === '(' || ch === '[' || ch === '{') {
        tokens.push({ type: 'LPAREN', val: ch, start, end: i + 1, hadSpace });
        i++; continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        tokens.push({ type: 'RPAREN', val: ch, start, end: i + 1, hadSpace });
        i++; continue;
      }
      if (ch === ',') {
        tokens.push({ type: 'COMMA', val: ',', start, end: i + 1, hadSpace });
        i++; continue;
      }

      // 13. Numbers (with optional thousands spaces and decimal comma/point)
      if (isDigit(ch)) {
        let j = i;
        while (j < n && isDigit(input[j])) j++;
        // Check thousands grouping: 1-3 leading digits followed by (space + exactly 3 digits)+
        let numStr = input.slice(i, j);
        if (numStr.length <= 3) {
          let k = j;
          const groups = [numStr];
          while (k < n && isSpace(input[k])) {
            let sEnd = k;
            while (sEnd < n && isSpace(input[sEnd])) sEnd++;
            if (sEnd - k === 1 && sEnd + 3 <= n &&
                isDigit(input[sEnd]) && isDigit(input[sEnd + 1]) && isDigit(input[sEnd + 2]) &&
                (sEnd + 3 >= n || !isDigit(input[sEnd + 3]))) {
              groups.push(input.slice(sEnd, sEnd + 3));
              k = sEnd + 3;
            } else {
              break;
            }
          }
          if (groups.length > 1) {
            numStr = groups.join('\\,');
            j = k;
          }
        }
        // Decimal part (comma or dot followed by digits)
        if (j + 1 < n && (input[j] === ',' || input[j] === '.') && isDigit(input[j + 1])) {
          const decSep = input[j] === ',' ? '{,}' : '.';
          j++;
          const decStart = j;
          while (j < n && isDigit(input[j])) j++;
          numStr += decSep + input.slice(decStart, j);
        }
        tokens.push({ type: 'NUMBER', val: input.slice(i, j), latex: numStr, start, end: j, hadSpace });
        i = j; continue;
      }

      // 14. Greek letters (optionally followed by Σ or digits subscript like ΦΣ, φ1)
      if (isGreek(ch)) {
        let j = i + 1;
        let sub = null;
        if (j < n && input[j] === 'Σ' && ch !== 'Σ') {
          sub = '\\Sigma';
          j++;
        } else if (j < n && isDigit(input[j])) {
          const dStart = j;
          while (j < n && isDigit(input[j])) j++;
          sub = input.slice(dStart, j);
        }
        tokens.push({
          type: 'IDENT',
          val: input.slice(i, j),
          base: GREEK_MAP[ch],
          sub,
          isGreek: true,
          start,
          end: j,
          hadSpace,
        });
        i = j; continue;
      }

      // 15. Units immediately following a NUMBER / RPAREN / PERCENT / DEGREE
      const canBeUnit = prev && (
        prev.type === 'NUMBER' || prev.type === 'RPAREN' ||
        prev.type === 'PERCENT' || prev.type === 'DEGREE' ||
        prev.type === 'SUP' || prev.type === 'VFRAC'
      );

      // 15a. Cyrillic unit (possibly compound like м/с, м/с², км/год, кг/м³)
      if (canBeUnit && isCyr(ch)) {
        const unitMatch = matchCompoundUnit(input, i, true);
        if (unitMatch) {
          tokens.push({
            type: 'UNIT',
            val: input.slice(i, unitMatch.end),
            latex: unitMatch.latex,
            start,
            end: unitMatch.end,
            hadSpace,
          });
          i = unitMatch.end; continue;
        }
      }

      // 15b. Latin unit (requires preceding space after number/value)
      if (canBeUnit && hadSpace && isLat(ch)) {
        const unitMatch = matchCompoundUnit(input, i, false);
        if (unitMatch) {
          tokens.push({
            type: 'UNIT',
            val: input.slice(i, unitMatch.end),
            latex: unitMatch.latex,
            start,
            end: unitMatch.end,
            hadSpace,
          });
          i = unitMatch.end; continue;
        }
      }

      // 16. Math functions (sin, cos, tg, log, sqrt, etc.)
      if (isLat(ch)) {
        const funcMatch = matchFunction(input, i);
        if (funcMatch) {
          tokens.push({
            type: 'FUNC',
            val: funcMatch.name,
            baseSub: funcMatch.sub || null,
            start,
            end: funcMatch.end,
            hadSpace,
          });
          i = funcMatch.end; continue;
        }

        // 17. Latin letter + Cyrillic subscript (e.g., Rйп.дор, Aкор, Fтяж, Rзаг)
        if (i + 1 < n && isCyr(input[i + 1])) {
          let j = i + 1;
          while (j < n) {
            if (isCyr(input[j])) { j++; }
            else if ((input[j] === '.' || input[j] === '-') && j + 1 < n && isCyr(input[j + 1])) { j++; }
            else break;
          }
          const subText = input.slice(i + 1, j);
          tokens.push({
            type: 'IDENT',
            val: input.slice(i, j),
            base: ch,
            sub: `\\text{${subText}}`,
            start,
            end: j,
            hadSpace,
          });
          i = j; continue;
        }

        // 18. Uppercase Latin + known English subscript (e.g., Rmax, Umin, Pnom)
        if (ch >= 'A' && ch <= 'Z') {
          let j = i + 1;
          while (j < n && input[j] >= 'a' && input[j] <= 'z') j++;
          const tail = input.slice(i + 1, j);
          if (tail && EN_SUBSCRIPTS.test(tail) && (j >= n || !isLat(input[j]))) {
            tokens.push({
              type: 'IDENT',
              val: input.slice(i, j),
              base: ch,
              sub: `\\text{${tail}}`,
              start,
              end: j,
              hadSpace,
            });
            i = j; continue;
          }
        }

        // 19. Check if this starts a multi-letter English prose word (4+ letters or stop-word)
        let wEnd = i;
        while (wEnd < n && isLat(input[wEnd])) wEnd++;
        const word = input.slice(i, wEnd);
        const wordLower = word.toLowerCase();
        // If it's a long Latin word (4+ chars, not a function) or an English stop-word (length >= 2)
        // except when directly preceded by _ (subscript) — handle subscript words in step 20!
        const isAfterSubOp = prev && prev.type === 'SUB_OP';
        if (isAfterSubOp) {
          tokens.push({
            type: 'IDENT',
            val: word,
            base: word.length > 1 ? `\\text{${word}}` : word,
            sub: null,
            start,
            end: wEnd,
            hadSpace,
          });
          i = wEnd; continue;
        }
        if ((word.length >= 4 && !MATH_FUNCS.has(wordLower)) ||
            (word.length >= 2 && ENGLISH_STOP_WORDS.has(wordLower))) {
          tokens.push({ type: 'PROSE', val: word, start, end: wEnd, hadSpace });
          i = wEnd; continue;
        }

        // 20. Single Latin variable optionally followed by Σ or digits (e.g., PΣ, R2, x1, v0, m1)
        if (i + 1 < n && input[i + 1] === 'Σ') {
          tokens.push({
            type: 'IDENT',
            val: input.slice(i, i + 2),
            base: ch,
            sub: '\\Sigma',
            start,
            end: i + 2,
            hadSpace,
          });
          i += 2; continue;
        }
        if (i + 1 < n && isDigit(input[i + 1])) {
          let j = i + 1;
          while (j < n && isDigit(input[j])) j++;
          tokens.push({
            type: 'IDENT',
            val: input.slice(i, j),
            base: ch,
            sub: input.slice(i + 1, j),
            start,
            end: j,
            hadSpace,
          });
          i = j; continue;
        }

        // 21. Single Latin variable (splitting 2-3 char groups like mc², 4ac, 2gh, ax² cleanly!)
        tokens.push({
          type: 'IDENT',
          val: ch,
          base: ch,
          sub: null,
          start,
          end: i + 1,
          hadSpace,
        });
        i++; continue;
      }

      // 22. Cyrillic after `_` subscript (e.g., R_макс or R_йп.дор)
      if (isCyr(ch) && prev && prev.type === 'SUB_OP') {
        let j = i;
        while (j < n) {
          if (isCyr(input[j])) j++;
          else if ((input[j] === '.' || input[j] === '-') && j + 1 < n && isCyr(input[j + 1])) j++;
          else break;
        }
        const subWord = input.slice(i, j);
        tokens.push({
          type: 'IDENT',
          val: subWord,
          base: `\\text{${subWord}}`,
          sub: null,
          start,
          end: j,
          hadSpace,
        });
        i = j; continue;
      }

      // 23. Cyrillic text inside `{...}` subscript (e.g., R_{йп.дор})
      if (isCyr(ch) && prev && prev.type === 'LPAREN' && prev.val === '{') {
        let j = i;
        while (j < n && input[j] !== '}') j++;
        if (j < n && input[j] === '}') {
          const inner = input.slice(i, j).trim();
          tokens.push({
            type: 'IDENT',
            val: inner,
            base: `\\text{${inner}}`,
            sub: null,
            start,
            end: j,
            hadSpace,
          });
          i = j; continue;
        }
      }

      // 23b. Cyrillic homoglyph variable (e.g., ФΣ = ..., Ен · S, Рзаг = ..., Р = U · I, С = 2πR, А1 = ...)
      if (Object.prototype.hasOwnProperty.call(CYR_HOMOGLYPHS, ch) &&
          !(i + 1 < n && isLat(input[i + 1]))) {
        let j = i + 1;
        let sub = null;
        let hasCyrSub = false;

        if (j < n && input[j] === 'Σ') {
          sub = '\\Sigma';
          j++;
        } else if (j < n && isDigit(input[j])) {
          const dStart = j;
          while (j < n && isDigit(input[j])) j++;
          sub = input.slice(dStart, j);
        } else if (j < n && CYR_LOWER_RE.test(input[j])) {
          // Potential Cyrillic subscript after uppercase homoglyph (e.g., Ен, Рзаг, Фзаг, Акор)
          let k = j;
          while (k < n) {
            if (CYR_LOWER_RE.test(input[k])) k++;
            else if ((input[k] === '.' || input[k] === '-') && k + 1 < n && CYR_LOWER_RE.test(input[k + 1])) k++;
            else break;
          }
          // Only accept if not followed by uppercase/other Cyrillic and length <= 8
          if (k > j && k - j <= 8 && (k >= n || !isCyr(input[k]))) {
            hasCyrSub = true;
            sub = `\\text{${input.slice(j, k)}}`;
            j = k;
          }
        }

        const nextNS = skipSpaces(input, j);
        const nextCh = nextNS < n ? input[nextNS] : '';
        const prevIsOp = prev && (
          prev.type === 'REL' || prev.type === 'ADD' || prev.type === 'MUL' ||
          prev.type === 'DIV' || prev.type === 'LPAREN' || prev.type === 'POW'
        );
        const nextIsStrongMath = (
          (j < n && (isSup(input[j]) || isSub(input[j]) || input[j] === '_' || input[j] === '^')) ||
          Object.prototype.hasOwnProperty.call(REL_MAP, nextCh) ||
          nextCh === '·' || nextCh === '⋅' || nextCh === '×' || nextCh === '/' || nextCh === '÷' ||
          nextCh === '+' || nextCh === '-' || nextCh === '−' || (prevIsOp && nextCh === ')')
        );
        const nextIsMath = nextIsStrongMath || (sub === '\\Sigma') || (sub && !hasCyrSub);

        if ((hasCyrSub && (prevIsOp || nextIsStrongMath)) ||
            (!hasCyrSub && !(i + 1 < n && isCyr(input[i + 1])) && (prevIsOp || nextIsMath))) {
          tokens.push({
            type: 'IDENT',
            val: input.slice(i, j),
            base: CYR_HOMOGLYPHS[ch],
            sub,
            start,
            end: j,
            hadSpace,
          });
          i = j; continue;
        }
      }

      // 24. Unrecognized / prose character or word
      if (isCyr(ch)) {
        let j = i;
        while (j < n && (isCyr(input[j]) || input[j] === "'" || input[j] === '’')) j++;
        tokens.push({ type: 'PROSE', val: input.slice(i, j), start, end: j, hadSpace });
        i = j; continue;
      }

      tokens.push({ type: 'UNKNOWN', val: ch, start, end: i + 1, hadSpace });
      i++;
    }

    return tokens;
  }

  function matchFunction(input, pos) {
    const n = input.length;
    for (const fn of FUNC_LIST) {
      if (!input.startsWith(fn, pos)) continue;
      const end = pos + fn.length;
      // Must not be part of a longer Latin word (except log2/log10 already in list)
      if (end < n && isLat(input[end])) continue;
      // Function should be followed by (, [, space+arg, ^, _, or unicode sup/sub
      // (so standalone word "min" or "sin" in prose isn't falsely treated as a function without arg)
      let look = end;
      while (look < n && (isSup(input[look]) || isSub(input[look]) || input[look] === '^' || input[look] === '_')) {
        if (input[look] === '^' || input[look] === '_') {
          look++;
          if (look < n && (input[look] === '(' || input[look] === '{')) {
            const close = input[look] === '(' ? ')' : '}';
            while (look < n && input[look] !== close) look++;
            if (look < n) look++;
          } else {
            while (look < n && (isDigit(input[look]) || isLat(input[look]))) look++;
          }
        } else {
          look++;
        }
      }
      const nextNonSpace = skipSpaces(input, look);
      if (nextNonSpace >= n) continue;
      const nc = input[nextNonSpace];
      if (nc === '(' || nc === '[' || isDigit(nc) || isGreek(nc) ||
          (isLat(nc) && (nextNonSpace === look || nextNonSpace - look === 1))) {
        if (fn === 'log2')  return { name: 'log', sub: '2', end };
        if (fn === 'log10') return { name: 'log', sub: '10', end };
        return { name: fn, sub: null, end };
      }
    }
    return null;
  }

  function skipSpaces(s, i) {
    while (i < s.length && isSpace(s[i])) i++;
    return i;
  }

  function readSingleUnit(input, pos, isCyrillic) {
    const n = input.length;
    let j = pos;
    if (isCyrillic) {
      while (j < n && isCyr(input[j])) j++;
      const word = input.slice(pos, j);
      if (!CYR_UNITS.has(word)) return null;
      return { word, end: j };
    } else {
      while (j < n && isLat(input[j])) j++;
      const word = input.slice(pos, j);
      if (LAT_MULTI_UNITS.has(word)) return { word, end: j };
      if (LAT_SINGLE_UNITS.has(word)) {
        // Single Latin unit only if followed by '/', sup, '^', or end/rel/punct/space+rel
        const after = j < n ? input[j] : '';
        if (after === '/' || isSup(after) || after === '^' || after === '' ||
            after === '.' || after === ',' || after === ';' || after === ')' || after === ']') {
          return { word, end: j };
        }
        const nextNS = skipSpaces(input, j);
        if (nextNS >= n) return { word, end: j };
        const nch = input[nextNS];
        if (Object.prototype.hasOwnProperty.call(REL_MAP, nch) || nch === ',' || nch === ';' || nch === '.') {
          return { word, end: j };
        }
      }
      return null;
    }
  }

  function readOptionalUnitExp(input, pos) {
    const n = input.length;
    if (pos < n && isSup(input[pos])) {
      let j = pos;
      let s = '';
      while (j < n && isSup(input[j])) { s += SUP_MAP[input[j]]; j++; }
      return { exp: s, end: j };
    }
    if (pos + 1 < n && input[pos] === '^') {
      let j = pos + 1;
      let sign = '';
      if (input[j] === '-' || input[j] === '+') { sign = input[j]; j++; }
      const dStart = j;
      while (j < n && isDigit(input[j])) j++;
      if (j > dStart) return { exp: sign + input.slice(dStart, j), end: j };
    }
    return { exp: null, end: pos };
  }

  function matchCompoundUnit(input, pos, isCyrillic) {
    const first = readSingleUnit(input, pos, isCyrillic);
    if (!first) return null;

    let end = first.end;
    const exp1 = readOptionalUnitExp(input, end);
    end = exp1.end;

    // Check for compound "/unit" (e.g., м/с, м/с², км/год, кг/м³, m/s²)
    if (end < input.length && input[end] === '/') {
      const second = readSingleUnit(input, end + 1, isCyrillic);
      if (second) {
        const exp2 = readOptionalUnitExp(input, second.end);
        const part1 = exp1.exp ? `\\text{${first.word}}^{${exp1.exp}}` : `\\text{${first.word}}`;
        const part2 = exp2.exp ? `\\text{${second.word}}^{${exp2.exp}}` : `\\text{${second.word}}`;
        return {
          latex: exp1.exp || exp2.exp
            ? `${part1}/${part2}`
            : `\\text{${first.word}/${second.word}}`,
          end: exp2.end,
        };
      }
    }

    // Check for dot-compound "·unit" (e.g., кВт·год, Н·м)
    if (end < input.length && (input[end] === '·' || input[end] === '⋅')) {
      const second = readSingleUnit(input, end + 1, isCyrillic);
      if (second) {
        const exp2 = readOptionalUnitExp(input, second.end);
        const part1 = exp1.exp ? `\\text{${first.word}}^{${exp1.exp}}` : `\\text{${first.word}}`;
        const part2 = exp2.exp ? `\\text{${second.word}}^{${exp2.exp}}` : `\\text{${second.word}}`;
        return {
          latex: `${part1}\\cdot${part2}`,
          end: exp2.end,
        };
      }
    }

    return {
      latex: exp1.exp ? `\\text{${first.word}}^{${exp1.exp}}` : `\\text{${first.word}}`,
      end,
    };
  }

  // ─── RECURSIVE DESCENT PARSER → AST → LATEX ────────────────────────────────
  function plainMathToLatex(exprStr) {
    const tokens = tokenize(exprStr);
    if (!tokens.length) return null;
    // Reject if tokenizer found PROSE or UNKNOWN
    if (tokens.some(t => t.type === 'PROSE' || t.type === 'UNKNOWN')) return null;

    let pos = 0;
    const peek = (offset = 0) => tokens[pos + offset] || null;
    const consume = () => tokens[pos++];

    function parseExpr() {
      return parseRel();
    }

    function parseRel() {
      let left = parseAdd();
      const parts = [{ op: null, node: left }];
      while (peek() && peek().type === 'REL') {
        const op = consume();
        const right = parseAdd();
        parts.push({ op: op.latex, node: right });
      }
      if (parts.length === 1) return left;
      return { kind: 'rel', parts };
    }

    function parseAdd() {
      let left = parseMulDiv();
      const terms = [{ op: null, node: left }];
      while (peek() && peek().type === 'ADD') {
        const op = consume();
        const right = parseMulDiv();
        terms.push({ op: op.latex, node: right });
      }
      if (terms.length === 1) return left;
      return { kind: 'add', terms };
    }

    function parseMulDiv() {
      let node = parseUnary();
      while (peek() && (peek().type === 'MUL' || peek().type === 'DIV')) {
        const op = consume();
        const right = parseUnary();
        if (op.type === 'DIV') {
          node = { kind: 'div', num: node, den: right };
        } else {
          node = { kind: 'mul', left: node, op: op.latex, right };
        }
      }
      return node;
    }

    function parseUnary() {
      const tok = peek();
      if (!tok) return { kind: 'empty' };
      if (tok.type === 'ADD') {
        consume();
        return { kind: 'unary', op: tok.latex, arg: parseUnary() };
      }
      if (tok.type === 'ROOT') {
        consume();
        const arg = parsePostfix();
        return { kind: 'root', deg: tok.deg, arg };
      }
      if (tok.type === 'BIGOP') {
        consume();
        let sub = null, sup = null;
        while (peek() && (peek().type === 'SUB_OP' || peek().type === 'SUB' || peek().type === 'POW' || peek().type === 'SUP')) {
          const t = consume();
          if (t.type === 'SUB_OP') sub = parseScriptArg();
          else if (t.type === 'SUB') sub = { kind: 'raw', latex: t.val };
          else if (t.type === 'POW') sup = parseScriptArg();
          else if (t.type === 'SUP') sup = { kind: 'raw', latex: t.val };
        }
        return { kind: 'bigop', latex: tok.latex, sub, sup };
      }
      return parseImplicitMul();
    }

    function canStartImplicitFactor(tok) {
      if (!tok) return false;
      return (
        tok.type === 'NUMBER' || tok.type === 'IDENT' || tok.type === 'FUNC' ||
        tok.type === 'LPAREN' || tok.type === 'ROOT'  || tok.type === 'UNIT' ||
        tok.type === 'VFRAC'  || tok.type === 'BIGOP'
      );
    }

    function parseImplicitMul() {
      const factors = [parsePostfix()];
      while (canStartImplicitFactor(peek())) {
        factors.push(parsePostfix());
      }
      if (factors.length === 1) return factors[0];
      return { kind: 'imul', factors };
    }

    function parseScriptArg() {
      const tok = peek();
      if (!tok) return { kind: 'empty' };
      if (tok.type === 'LPAREN' && (tok.val === '(' || tok.val === '{')) {
        const closeVal = tok.val === '(' ? ')' : '}';
        consume();
        const inner = parseExpr();
        if (peek() && peek().type === 'RPAREN' && peek().val === closeVal) consume();
        return inner;
      }
      if (tok.type === 'ADD' && (tok.val === '-' || tok.val === '+')) {
        consume();
        return { kind: 'unary', op: tok.latex, arg: parsePrimary() };
      }
      return parsePrimary();
    }

    function parsePostfix() {
      let node = parsePrimary();
      while (peek()) {
        const t = peek();
        if (t.type === 'SUB_OP') {
          consume();
          const sub = parseScriptArg();
          node = attachSub(node, sub);
        } else if (t.type === 'SUB') {
          consume();
          node = attachSub(node, { kind: 'raw', latex: t.val });
        } else if (t.type === 'POW') {
          consume();
          const sup = parseScriptArg();
          node = attachSup(node, sup);
        } else if (t.type === 'SUP') {
          consume();
          node = attachSup(node, { kind: 'raw', latex: t.val });
        } else if (t.type === 'PRIME') {
          consume();
          node = { kind: 'prime', base: node, val: t.val };
        } else if (t.type === 'FACT') {
          consume();
          node = { kind: 'postfix', base: node, suffix: '!' };
        } else if (t.type === 'PERCENT') {
          consume();
          node = { kind: 'postfix', base: node, suffix: '\\%' };
        } else if (t.type === 'DEGREE') {
          consume();
          const suffix = t.scale ? `\\,^{\\circ}\\text{${t.scale}}` : '^{\\circ}';
          node = { kind: 'postfix', base: node, suffix };
        } else {
          break;
        }
      }
      return node;
    }

    function attachSub(node, subNode) {
      if (node.kind === 'script') {
        return { ...node, sub: subNode };
      }
      if (node.kind === 'ident' && !node.sub) {
        return { kind: 'script', base: node, sub: subNode, sup: null };
      }
      return { kind: 'script', base: node, sub: subNode, sup: null };
    }

    function attachSup(node, supNode) {
      if (node.kind === 'script') {
        return { ...node, sup: supNode };
      }
      return { kind: 'script', base: node, sub: null, sup: supNode };
    }

    function parsePrimary() {
      const tok = peek();
      if (!tok) return { kind: 'empty' };

      if (tok.type === 'NUMBER') {
        consume();
        return { kind: 'num', latex: tok.latex };
      }

      if (tok.type === 'VFRAC') {
        consume();
        return { kind: 'div', num: { kind: 'raw', latex: tok.num }, den: { kind: 'raw', latex: tok.den } };
      }

      if (tok.type === 'UNIT') {
        consume();
        return { kind: 'unit', latex: tok.latex };
      }

      if (tok.type === 'IDENT') {
        consume();
        if (tok.sub) {
          return {
            kind: 'script',
            base: { kind: 'ident', latex: tok.base },
            sub: { kind: 'raw', latex: tok.sub },
            sup: null,
          };
        }
        return { kind: 'ident', latex: tok.base || tok.latex };
      }

      if (tok.type === 'FUNC') {
        consume();
        let sub = tok.baseSub ? { kind: 'raw', latex: tok.baseSub } : null;
        let sup = null;
        // Function exponents/subscripts before argument, e.g. sin²(x), log_2(x)
        while (peek() && (peek().type === 'POW' || peek().type === 'SUP' || peek().type === 'SUB_OP' || peek().type === 'SUB')) {
          const st = consume();
          if (st.type === 'POW') sup = parseScriptArg();
          else if (st.type === 'SUP') sup = { kind: 'raw', latex: st.val };
          else if (st.type === 'SUB_OP') sub = parseScriptArg();
          else if (st.type === 'SUB') sub = { kind: 'raw', latex: st.val };
        }
        let arg = null;
        if (peek() && peek().type === 'LPAREN') {
          arg = parseParen();
        } else if (peek() && (peek().type === 'NUMBER' || peek().type === 'IDENT' || peek().type === 'ROOT' || peek().type === 'FUNC')) {
          arg = parsePostfix();
        }
        return { kind: 'func', name: tok.val, sub, sup, arg };
      }

      if (tok.type === 'LPAREN') {
        return parseParen();
      }

      if (tok.type === 'ROOT') {
        consume();
        return { kind: 'root', deg: tok.deg, arg: parsePostfix() };
      }

      // Unexpected token
      consume();
      return { kind: 'raw', latex: tok.latex || tok.val };
    }

    function parseParen() {
      const open = consume();
      const closeMap = { '(': ')', '[': ']', '{': '}' };
      const expectedClose = closeMap[open.val];
      const items = [];
      if (peek() && !(peek().type === 'RPAREN' && peek().val === expectedClose)) {
        items.push(parseExpr());
        while (peek() && peek().type === 'COMMA') {
          consume();
          items.push(parseExpr());
        }
      }
      if (peek() && peek().type === 'RPAREN' && peek().val === expectedClose) {
        consume();
      }
      if (items.length === 1) {
        return { kind: 'paren', open: open.val, close: expectedClose, inner: items[0] };
      }
      return { kind: 'parenList', open: open.val, close: expectedClose, items };
    }

    const ast = parseExpr();
    // Ensure all tokens were consumed
    if (pos < tokens.length) return null;

    const latex = emitLatex(ast, { unwrapDivParen: true });
    return latex && latex.trim() ? latex.trim() : null;
  }

  function unwrapParen(node) {
    if (node && node.kind === 'paren' && (node.open === '(' || node.open === '{')) {
      return node.inner;
    }
    return node;
  }

  function isTallLatex(ltx) {
    return /\\frac|\\sqrt|\\sum|\\prod|\\int/.test(ltx);
  }

  function emitLatex(node, ctx = {}) {
    if (!node || node.kind === 'empty') return '';

    switch (node.kind) {
      case 'raw':
      case 'num':
      case 'ident':
        return node.latex;

      case 'unit':
        return node.latex;

      case 'rel':
        return node.parts.map((p, idx) => {
          const s = emitLatex(p.node, { unwrapDivParen: true });
          return idx === 0 ? s : ` ${p.op} ${s}`;
        }).join('');

      case 'add':
        return node.terms.map((t, idx) => {
          const s = emitLatex(t.node, { unwrapDivParen: true });
          return idx === 0 ? s : ` ${t.op} ${s}`;
        }).join('');

      case 'mul': {
        const l = emitLatex(node.left, { unwrapDivParen: true });
        const r = emitLatex(node.right, { unwrapDivParen: true });
        return `${l} ${node.op} ${r}`;
      }

      case 'div': {
        const numNode = unwrapParen(node.num);
        const denNode = unwrapParen(node.den);
        const num = emitLatex(numNode, { unwrapDivParen: false });
        const den = emitLatex(denNode, { unwrapDivParen: false });
        return `\\frac{${num}}{${den}}`;
      }

      case 'unary': {
        const arg = emitLatex(node.arg, { unwrapDivParen: true });
        return `${node.op}${arg}`;
      }

      case 'root': {
        const inner = unwrapParen(node.arg);
        const innerLtx = emitLatex(inner, { unwrapDivParen: true });
        return node.deg ? `\\sqrt[${node.deg}]{${innerLtx}}` : `\\sqrt{${innerLtx}}`;
      }

      case 'bigop': {
        let out = node.latex;
        if (node.sub) out += `_{${emitLatex(node.sub)}}`;
        if (node.sup) out += `^{${emitLatex(node.sup)}}`;
        return out;
      }

      case 'imul': {
        let out = '';
        for (let idx = 0; idx < node.factors.length; idx++) {
          const f = node.factors[idx];
          const prevF = idx > 0 ? node.factors[idx - 1] : null;
          const s = emitLatex(f, { unwrapDivParen: false });
          if (idx === 0) {
            out = s;
          } else if (f.kind === 'unit') {
            out += `\\,${s}`;
          } else if (prevF && prevF.kind === 'func') {
            out += ` ${s}`;
          } else if (/\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z]/.test(s)) {
            out += ` ${s}`;
          } else {
            out += s;
          }
        }
        return out;
      }

      case 'script': {
        // Preserve parens on base if raised to power (e.g. (a/b)^2 -> \left(\frac{a}{b}\right)^{2})
        const base = emitLatex(node.base, { unwrapDivParen: false });
        let out = base;
        if (node.sub) out += `_{${emitLatex(node.sub, { unwrapDivParen: true })}}`;
        if (node.sup) out += `^{${emitLatex(node.sup, { unwrapDivParen: true })}}`;
        return out;
      }

      case 'prime':
        return `${emitLatex(node.base, { unwrapDivParen: false })}${node.val}`;

      case 'postfix':
        return `${emitLatex(node.base, { unwrapDivParen: false })}${node.suffix}`;

      case 'func': {
        if (node.name === 'sqrt' || node.name === 'cbrt') {
          const inner = node.arg ? unwrapParen(node.arg) : null;
          const argLtx = inner ? emitLatex(inner, { unwrapDivParen: true }) : '';
          return node.name === 'cbrt' ? `\\sqrt[3]{${argLtx}}` : `\\sqrt{${argLtx}}`;
        }
        if (node.name === 'abs') {
          const inner = node.arg ? unwrapParen(node.arg) : null;
          const argLtx = inner ? emitLatex(inner, { unwrapDivParen: true }) : '';
          return `\\left|${argLtx}\\right|`;
        }
        let fn = KATEX_NATIVE_FUNCS.has(node.name)
          ? `\\${node.name}`
          : `\\operatorname{${node.name}}`;
        if (node.sub) fn += `_{${emitLatex(node.sub, { unwrapDivParen: true })}}`;
        if (node.sup) fn += `^{${emitLatex(node.sup, { unwrapDivParen: true })}}`;
        if (!node.arg) return fn;
        if (node.arg.kind === 'paren' || node.arg.kind === 'parenList') {
          return `${fn}${emitLatex(node.arg, { unwrapDivParen: false })}`;
        }
        return `${fn} ${emitLatex(node.arg, { unwrapDivParen: false })}`;
      }

      case 'paren': {
        if (node.open === '{') {
          return `{${emitLatex(node.inner, { unwrapDivParen: true })}}`;
        }
        // Unwrap redundant outer parentheses around a pure fraction when safe
        // (e.g. (π · φ / 360) · (...) -> \frac{\pi \cdot \varphi}{360} \cdot (...))
        if (ctx.unwrapDivParen && node.open === '(' && node.inner && node.inner.kind === 'div') {
          return emitLatex(node.inner, { unwrapDivParen: false });
        }
        const inner = emitLatex(node.inner, { unwrapDivParen: true });
        if (isTallLatex(inner)) {
          return `\\left${node.open}${inner}\\right${node.close}`;
        }
        return `${node.open}${inner}${node.close}`;
      }

      case 'parenList': {
        const inner = node.items.map(it => emitLatex(it, { unwrapDivParen: true })).join(', ');
        if (isTallLatex(inner)) {
          return `\\left${node.open}${inner}\\right${node.close}`;
        }
        return `${node.open}${inner}${node.close}`;
      }

      default:
        return '';
    }
  }

  // ─── FORMULA VALIDATION ────────────────────────────────────────────────────
  const DATE_RE = /^\s*\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\s*$/;
  const SIMPLE_RANGE_RE = /^\s*\(?\s*\d+(?:[,.]\d+)?\s*[-–−]\s*\d+(?:[,.]\d+)?(?:\s*[°%а-яА-ЯіІїЇєЄґҐa-zA-Z]+)?\s*\)?\s*$/;
  const SIMPLE_RATIO_RE = /^\s*\(?\s*\d+\s*\/\s*\d+\s*\)?\s*$/;

  function isRealFormula(rawSpan) {
    const trimmed = rawSpan.trim();
    if (trimmed.length < 2) return false;
    if (DATE_RE.test(trimmed)) return false;
    if (SIMPLE_RANGE_RE.test(trimmed)) return false;
    if (SIMPLE_RATIO_RE.test(trimmed)) return false;

    const tokens = tokenize(trimmed);
    if (!tokens.length) return false;
    if (tokens.some(t => t.type === 'PROSE' || t.type === 'UNKNOWN')) return false;

    // Check balanced parens
    let depth = 0;
    for (const t of tokens) {
      if (t.type === 'LPAREN') depth++;
      else if (t.type === 'RPAREN') { depth--; if (depth < 0) return false; }
    }
    if (depth !== 0) return false;

    // Reject if starts or ends with a binary relation or dangling operator
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if (first.type === 'REL' || first.type === 'MUL' || first.type === 'DIV' || first.type === 'POW' || first.type === 'SUB_OP') {
      return false;
    }
    if (last.type === 'REL' || last.type === 'MUL' || last.type === 'DIV' || last.type === 'ADD' || last.type === 'POW' || last.type === 'SUB_OP') {
      return false;
    }

    let hasRel = false;
    let hasRootOrBig = false;
    let hasFunc = false;
    let hasBinOp = false;
    let binOpCount = 0;
    let hasExplicitMathOp = false;
    let hasIdent = false;
    let hasGreek = false;
    let hasSupOrPow = false;
    let hasSub = false;
    let hasParen = false;

    for (const t of tokens) {
      if (t.type === 'REL') hasRel = true;
      if (t.type === 'ROOT' || t.type === 'BIGOP') hasRootOrBig = true;
      if (t.type === 'FUNC') hasFunc = true;
      if (t.type === 'ADD' || t.type === 'MUL' || t.type === 'DIV') {
        hasBinOp = true;
        binOpCount++;
        if (t.val === '·' || t.val === '⋅' || t.val === '×' || t.val === '÷' || t.val === '±' || t.val === '∓') {
          hasExplicitMathOp = true;
        }
      }
      if (t.type === 'IDENT') {
        hasIdent = true;
        if (t.isGreek) hasGreek = true;
        if (t.sub) hasSub = true;
      }
      if (t.type === 'POW' || t.type === 'SUP') hasSupOrPow = true;
      if (t.type === 'SUB' || t.type === 'SUB_OP') hasSub = true;
      if (t.type === 'LPAREN') hasParen = true;
    }

    // Rule 1: Relation (=, ≈, ≤, ≥, ≠, <, >, etc.) with tokens on both sides
    if (hasRel) {
      // Avoid matching lone "a > b" where a/b are suspicious? Both are valid math tokens here.
      return true;
    }

    // Rule 2: Radical or big operator (√, ∛, ∑, ∫)
    if (hasRootOrBig) return true;

    // Rule 3: Math function (sin(x), cos(φ), log(2), etc.)
    if (hasFunc) return true;

    // Rule 4: Binary operator combined with math structure
    if (hasBinOp && (hasIdent || hasGreek || hasSupOrPow || hasParen || binOpCount >= 2 || hasExplicitMathOp)) {
      return true;
    }

    // Rule 5: Variable with BOTH subscript and superscript (e.g., Rйп.дор², R2², x₁²)
    if (hasIdent && hasSub && hasSupOrPow) {
      return true;
    }

    return false;
  }

  // ─── DOCUMENT / LINE SCANNER ───────────────────────────────────────────────

  const START_BOUNDARY_RE = /[\s:;,\(\[\{«"—–]/;
  const END_BOUNDARY_RE   = /[\s.,;:!\?\)\\\]\}»"—–]/;

  function isValidStartBoundary(str, idx) {
    if (idx === 0) return true;
    return START_BOUNDARY_RE.test(str[idx - 1]);
  }

  function isValidEndBoundary(str, idx) {
    if (idx >= str.length) return true;
    return END_BOUNDARY_RE.test(str[idx]);
  }

  function findInlineFormulaEnd(line, startIdx) {
    const n = line.length;
    let i = startIdx;
    let parenStack = [];
    let bestEnd = -1;

    while (i < n) {
      // Stop on protected placeholder markers
      if (line.startsWith('%%MATH_', i) || line.startsWith('%%PROT_', i)) break;

      const ch = line[i];

      // Stop on markdown bold/italic double-star or backtick
      if (ch === '`' || (ch === '*' && line[i + 1] === '*')) break;
      // Stop on em-dash (prose)
      if (ch === '—') break;

      // Track parentheses
      if (ch === '(' || ch === '[' || ch === '{') {
        const closeMap = { '(': ')', '[': ']', '{': '}' };
        parenStack.push(closeMap[ch]);
        i++;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        if (parenStack.length && parenStack[parenStack.length - 1] === ch) {
          parenStack.pop();
          i++;
          if (parenStack.length === 0) {
            const slice = line.slice(startIdx, i);
            const toks = tokenize(slice);
            if (toks.some(t => t.type === 'PROSE' || t.type === 'UNKNOWN')) {
              break;
            }
            if (isValidEndBoundary(line, i)) {
              bestEnd = i;
            }
          }
          continue;
        }
        break;
      }

      // Sentence punctuation outside parens stops the scan
      if (parenStack.length === 0) {
        if (ch === ';' || ch === ':' || ch === '?' || ch === '!' || ch === '»' || ch === '"') break;
        if (ch === '.' && (i + 1 >= n || !isDigit(line[i + 1]))) {
          // Allow dot inside Latin+Cyrillic subscript like Rйп.дор
          if (!(i > startIdx && isCyr(line[i - 1]) && i + 1 < n && isCyr(line[i + 1]))) {
            break;
          }
        }
        if (ch === ',' && (i + 1 >= n || (!isDigit(line[i + 1]) && !isSub(line[i + 1])))) {
          break;
        }
      }

      // Try tokenizing the slice from startIdx to next boundary to see if we hit prose
      if (isSpace(ch)) {
        // Peek ahead past spaces
        let next = i;
        while (next < n && isSpace(line[next])) next++;
        if (next >= n) break;
        if (line.startsWith('%%MATH_', next) || line.startsWith('%%PROT_', next)) break;
        if (line[next] === '—' || line[next] === ';' || line[next] === ':' ||
            line[next] === '!' || line[next] === '?' || line[next] === '`' ||
            (line[next] === '*' && line[next + 1] === '*')) break;

        // Check if current prefix is valid (no PROSE/UNKNOWN) when parens are balanced
        if (parenStack.length === 0) {
          const slice = line.slice(startIdx, i);
          // Allow single Cyrillic homoglyph (e.g., "Р") when followed by a math operator/relation
          const isSingleHomoglyph = slice.length === 1 && Object.prototype.hasOwnProperty.call(CYR_HOMOGLYPHS, slice);
          if (!(isSingleHomoglyph && (Object.prototype.hasOwnProperty.call(REL_MAP, line[next]) || line[next] === '·' || line[next] === '=' || line[next] === '/' || line[next] === '+' || line[next] === '-'))) {
            const toks = tokenize(slice);
            if (toks.some(t => t.type === 'PROSE' || t.type === 'UNKNOWN')) break;
            bestEnd = i;
          }
        }
        i = next;
        continue;
      }

      i++;
      if (parenStack.length === 0 && isValidEndBoundary(line, i)) {
        const slice = line.slice(startIdx, i);
        const isSingleHomoglyph = slice.length === 1 && Object.prototype.hasOwnProperty.call(CYR_HOMOGLYPHS, slice);
        if (!isSingleHomoglyph) {
          const toks = tokenize(slice);
          if (toks.some(t => t.type === 'PROSE' || t.type === 'UNKNOWN')) {
            break;
          }
          bestEnd = i;
        }
      }
    }

    if (bestEnd === -1 && parenStack.length === 0) {
      const slice = line.slice(startIdx, i);
      const toks = tokenize(slice);
      if (!toks.some(t => t.type === 'PROSE' || t.type === 'UNKNOWN')) {
        bestEnd = i;
      }
    }

    if (bestEnd <= startIdx) return -1;

    // Trim trailing spaces and dangling operators
    let end = bestEnd;
    while (end > startIdx) {
      const candidate = line.slice(startIdx, end).trimEnd();
      end = startIdx + candidate.length;
      if (end <= startIdx) return -1;
      const lastChar = candidate[candidate.length - 1];
      if (lastChar === '+' || lastChar === '-' || lastChar === '−' || lastChar === '–' ||
          lastChar === '·' || lastChar === '×' || lastChar === '*' || lastChar === '/' ||
          lastChar === '=' || lastChar === ',' || lastChar === '^' || lastChar === '_') {
        end--;
        continue;
      }
      break;
    }

    return end > startIdx ? end : -1;
  }

  function processLineSegment(segment, isInTable, allowDisplay, maths, idxRef) {
    if (!segment || !segment.trim()) return segment;

    // Step A: Check if the ENTIRE segment is a standalone formula (optionally with trailing punct)
    const trimmed = segment.trim();
    if (!trimmed.includes('%%MATH_') && !trimmed.includes('%%PROT_')) {
      let body = trimmed;
      let trailingPunct = '';
      const punctMatch = body.match(/([.,;])\s*$/);
      if (punctMatch) {
        body = body.slice(0, body.length - punctMatch[0].length).trimEnd();
        trailingPunct = punctMatch[1];
      }
      if (isRealFormula(body)) {
        const latex = plainMathToLatex(body);
        if (latex) {
          const isDisplay = allowDisplay && !isInTable;
          const ph = `%%MATH_${idxRef.idx}_${isDisplay ? 'D' : 'I'}%%`;
          maths.push({
            placeholder: ph,
            raw: latex,
            originalPlain: body,
            display: isDisplay,
            inTable: isInTable,
            isPlain: true,
            trailingPunct: isDisplay ? trailingPunct : '',
          });
          idxRef.idx++;
          const leadSpace = segment.match(/^\s*/)[0];
          const trailSpace = segment.match(/\s*$/)[0];
          return isDisplay
            ? `${leadSpace}${ph}${trailSpace}`
            : `${leadSpace}${ph}${trailingPunct}${trailSpace}`;
        }
      }
    }

    // Step B: Scan for inline formulas inside prose
    let out = '';
    let i = 0;
    const n = segment.length;

    while (i < n) {
      // Skip protected tokens intact
      if (segment.startsWith('%%MATH_', i) || segment.startsWith('%%PROT_', i)) {
        const endPh = segment.indexOf('%%', i + 2);
        if (endPh !== -1) {
          out += segment.slice(i, endPh + 2);
          i = endPh + 2;
          continue;
        }
      }

      if (isValidStartBoundary(segment, i) && !isSpace(segment[i])) {
        const ch = segment[i];
        const canStart = (
          isLat(ch) || isDigit(ch) || isGreek(ch) ||
          Object.prototype.hasOwnProperty.call(CYR_HOMOGLYPHS, ch) ||
          ch === '(' || ch === '[' || ch === '√' || ch === '∛' || ch === '∜' ||
          ch === '∑' || ch === '∏' || ch === '∫' || ch === '±' ||
          ((ch === '-' || ch === '−') && i + 1 < n && (isDigit(segment[i + 1]) || isLat(segment[i + 1]) || isGreek(segment[i + 1]) || segment[i + 1] === '('))
        );

        if (canStart) {
          const end = findInlineFormulaEnd(segment, i);
          if (end > i) {
            let spanStart = i;
            let spanEnd = end;
            let candidate = segment.slice(spanStart, spanEnd);
            // If the matched span is wrapped in prose parens around a relation (e.g. "(S = π · R²)"),
            // keep the outer parens as regular prose text.
            if (candidate.startsWith('(') && candidate.endsWith(')')) {
              const inner = candidate.slice(1, -1);
              let bal = 0, wrapsWhole = true;
              for (let k = 0; k < inner.length; k++) {
                if (inner[k] === '(') bal++;
                else if (inner[k] === ')') { bal--; if (bal < 0) { wrapsWhole = false; break; } }
              }
              if (wrapsWhole && bal === 0 && tokenize(inner).some(t => t.type === 'REL')) {
                // Emit '(' as prose and let the next iteration parse inner cleanly
                out += '(';
                i++;
                continue;
              }
            }
            if (isRealFormula(candidate)) {
              const latex = plainMathToLatex(candidate);
              if (latex) {
                const ph = `%%MATH_${idxRef.idx}_I%%`;
                maths.push({
                  placeholder: ph,
                  raw: latex,
                  originalPlain: candidate,
                  display: false,
                  inTable: isInTable,
                  isPlain: true,
                  trailingPunct: '',
                });
                idxRef.idx++;
                out += ph;
                i = spanEnd;
                continue;
              }
            }
          }
        }
      }

      out += segment[i];
      i++;
    }

    return out;
  }

  /**
   * Detect and extract plain-text symbolic formulas from `text` (which already has
   * explicit LaTeX formulas replaced with `%%MATH_N_D%%` / `%%MATH_N_I%%`).
   * Appends newly extracted math objects to `maths` and returns `{ cleaned, nextIdx }`.
   */
  function extractPlainMath(text, maths, startIdx) {
    const protectedChunks = [];
    const protect = (str, regex) => str.replace(regex, (m) => {
      const id = `%%PROT_${protectedChunks.length}%%`;
      protectedChunks.push(m);
      return id;
    });

    let working = text;
    // 1. Protect fenced code blocks
    working = protect(working, /```[\s\S]*?```/g);
    // 2. Protect inline code
    working = protect(working, /`[^`\n]+`/g);
    // 3. Protect markdown links [label](url) URLs & raw URLs
    working = protect(working, /\]\([^)\n]+\)/g);
    working = protect(working, /https?:\/\/[^\s<>()]+/g);
    working = protect(working, /www\.[^\s<>()]+/g);
    // 4. Protect HTML tags
    working = protect(working, /<[a-zA-Z\/][^>\n]*>/g);
    // 5. Protect keyboard shortcuts (Ctrl+V, Alt+=, Shift+Enter, etc.)
    working = protect(working, /\b(?:Ctrl|Alt|Shift|Cmd|Win|Fn)\s*\+\s*(?:[A-Za-z0-9=+\-]|Enter|Tab|Esc|Space|F\d{1,2})\b/gi);

    const idxRef = { idx: startIdx };
    const lines = working.split('\n');
    const processedLines = lines.map((line) => {
      const trimLine = line.trim();
      if (!trimLine) return line;

      // Skip markdown table delimiter rows (|---|---|)
      if (/^\|?[\s:-]+\|[\s|:-]*$/.test(trimLine)) return line;

      // Markdown table row: process each cell separately with inTable = true
      if (trimLine.startsWith('|') || (trimLine.includes('|') && trimLine.split('|').length >= 3)) {
        return line.split('|').map(cell =>
          processLineSegment(cell, true, false, maths, idxRef)
        ).join('|');
      }

      // Check leading markdown prefixes (headings, blockquotes, lists)
      const prefixMatch = line.match(/^(\s*(?:>+\s*|#{1,6}\s+|[-*•+]\s+|\d+[.)]\s+))/);
      if (prefixMatch) {
        const prefix = prefixMatch[1];
        const body = line.slice(prefix.length);
        // Inside headings or lists, keep formulas inline so markdown structure stays intact
        return prefix + processLineSegment(body, false, false, maths, idxRef);
      }

      // Normal line: allow standalone block (display) formula if the entire line is a formula
      return processLineSegment(line, false, true, maths, idxRef);
    });

    let cleaned = processedLines.join('\n');

    // Restore protected chunks in reverse order (handles nested protections)
    for (let k = protectedChunks.length - 1; k >= 0; k--) {
      cleaned = cleaned.replace(`%%PROT_${k}%%`, () => protectedChunks[k]);
    }

    return { cleaned, nextIdx: idxRef.idx };
  }

  return {
    tokenize,
    plainMathToLatex,
    isRealFormula,
    extractPlainMath,
  };
});
