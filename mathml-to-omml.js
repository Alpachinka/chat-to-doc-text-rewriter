/* ====================================================
   ChatToDoc — mathml-to-omml.js
   Clean Presentation MathML → Microsoft Word OMML
   (<m:oMath> / <m:oMathPara>) converter for native
   editable MS Word equations on Ctrl+V.
   ==================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MathMLToOMML = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OMML_NS = 'http://schemas.microsoft.com/office/2004/12/omml';

  const NARY_OPS = new Set([
    '∑', '∏', '∐', '∫', '∬', '∭', '∮', '∯', '∰',
    '⋃', '⋂', '⋁', '⋀', '⨁', '⨂', '⨀',
  ]);

  const INTEGRAL_OPS = new Set(['∫', '∬', '∭', '∮', '∯', '∰']);

  const ACCENT_MAP = {
    '¯': '\u0304', 'ˉ': '\u0304', '‾': '\u0304', '―': '\u0304',
    '^': '\u0302', 'ˆ': '\u0302',
    '~': '\u0303', '˜': '\u0303',
    '˙': '\u0307', '¨': '\u0308',
    '→': '\u20D7', '⃗': '\u20D7',
    '←': '\u20D6', '↔': '\u20E1',
    'ˇ': '\u030C', '˘': '\u0306', '´': '\u0301', '`': '\u0300',
  };

  const REL_BREAK_OPS = new Set([
    '=', '≠', '≈', '≡', '≤', '≥', '<', '>', ',', ';', '⇒', '⇔', '→', '∝',
  ]);

  const OPEN_FENCES  = new Set(['(', '[', '{', '|', '‖', '⟨', '⌊', '⌈']);
  const CLOSE_FENCES = new Set([')', ']', '}', '|', '‖', '⟩', '⌋', '⌉']);

  function escXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escAttr(str) {
    return escXml(str).replace(/"/g, '&quot;');
  }

  function decodeXmlEntities(str) {
    return String(str)
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, '\u00A0')
      .replace(/&amp;/g, '&');
  }

  // ─── LIGHTWEIGHT XML PARSER (works identically in Browser & Node) ─────────
  function parseXmlToTree(xmlStr) {
    const rootNode = { tag: '#root', attrs: {}, children: [] };
    const stack = [rootNode];
    const tagRe = /<!--[\s\S]*?-->|<\/([A-Za-z0-9:_-]+)\s*>|<([A-Za-z0-9:_-]+)([^>]*?)(\/?)>|([^<]+)/g;
    let m;

    while ((m = tagRe.exec(xmlStr)) !== null) {
      const parent = stack[stack.length - 1];
      if (m[1]) {
        // Closing tag
        const closeTag = m[1].toLowerCase().replace(/^.*:/, '');
        for (let i = stack.length - 1; i >= 1; i--) {
          if (stack[i].tag === closeTag) {
            stack.length = i;
            break;
          }
        }
      } else if (m[2]) {
        // Opening or self-closing tag
        const tag = m[2].toLowerCase().replace(/^.*:/, '');
        const attrs = {};
        const attrStr = m[3] || '';
        const attrRe = /([A-Za-z0-9:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let am;
        while ((am = attrRe.exec(attrStr)) !== null) {
          attrs[am[1].toLowerCase()] = decodeXmlEntities(am[2] !== undefined ? am[2] : am[3]);
        }
        const node = { tag, attrs, children: [] };
        parent.children.push(node);
        if (!m[4]) {
          stack.push(node);
        }
      } else if (m[5]) {
        // Text node
        const text = decodeXmlEntities(m[5]);
        if (text) {
          parent.children.push({ tag: '#text', text });
        }
      }
    }

    return rootNode;
  }

  function findFirstTag(node, tagName) {
    if (!node) return null;
    if (node.tag === tagName) return node;
    if (node.children) {
      for (const ch of node.children) {
        const found = findFirstTag(ch, tagName);
        if (found) return found;
      }
    }
    return null;
  }

  function getElementChildren(node) {
    if (!node || !node.children) return [];
    return node.children.filter(c => c.tag !== '#text');
  }

  function getTextContent(node) {
    if (!node) return '';
    if (node.tag === '#text') return node.text || '';
    return (node.children || []).map(getTextContent).join('');
  }

  // ─── OMML RUN HELPER ───────────────────────────────────────────────────────
  function makeRun(text, opts = {}) {
    if (!text) return '';
    let rPr = '';
    if (opts.normal) rPr += '<m:nor/>';
    if (opts.bold && opts.italic) rPr += '<m:sty m:val="bi"/>';
    else if (opts.bold) rPr += '<m:sty m:val="b"/>';
    else if (opts.plain) rPr += '<m:sty m:val="p"/>';

    const rPrXml = rPr ? `<m:rPr>${rPr}</m:rPr>` : '';
    const needsPreserve = /^\s|\s$|\u00A0|\u2009|\u2002|\u2003/.test(text);
    const spaceAttr = needsPreserve ? ' xml:space="preserve"' : '';
    return `<m:r>${rPrXml}<m:t${spaceAttr}>${escXml(text)}</m:t></m:r>`;
  }

  function styleOptsFromVariant(variant, isTextOrNormal) {
    const opts = {};
    if (isTextOrNormal) opts.normal = true;
    if (variant === 'normal' || variant === 'roman') {
      opts.normal = true;
    } else if (variant === 'bold') {
      opts.bold = true;
    } else if (variant === 'bold-italic') {
      opts.bold = true;
      opts.italic = true;
    }
    return opts;
  }

  // ─── CHECK IF NODE IS AN N-ARY OPERATOR STRUCTURE ─────────────────────────
  function extractNaryInfo(node) {
    if (!node) return null;
    const tag = node.tag;
    if (tag === 'mo') {
      const op = getTextContent(node).trim();
      if (NARY_OPS.has(op)) {
        return { op, sub: null, sup: null, limLoc: INTEGRAL_OPS.has(op) ? 'subSup' : 'undOvr' };
      }
      return null;
    }
    if (tag === 'msub' || tag === 'msup' || tag === 'msubsup' ||
        tag === 'munder' || tag === 'mover' || tag === 'munderover') {
      const kids = getElementChildren(node);
      if (!kids.length) return null;
      const base = kids[0];
      if (base.tag === 'mo') {
        const op = getTextContent(base).trim();
        if (NARY_OPS.has(op)) {
          let sub = null, sup = null;
          if (tag === 'msub' || tag === 'munder') {
            sub = kids[1] || null;
          } else if (tag === 'msup' || tag === 'mover') {
            sup = kids[1] || null;
          } else {
            sub = kids[1] || null;
            sup = kids[2] || null;
          }
          const isUndOvr = (tag === 'munder' || tag === 'mover' || tag === 'munderover') && !INTEGRAL_OPS.has(op);
          return { op, sub, sup, limLoc: isUndOvr ? 'undOvr' : 'subSup' };
        }
      }
    }
    return null;
  }

  function isBreakOperator(node) {
    if (!node || node.tag !== 'mo') return false;
    return REL_BREAK_OPS.has(getTextContent(node).trim());
  }

  // ─── CONVERT LIST OF MATHML NODES (handles n-ary operands & fences) ────────
  function convertChildren(nodes, inheritedVariant) {
    if (!nodes || !nodes.length) return '';

    // Check if the entire mrow is wrapped in matching stretchy fences (e.g. \left( ... \right))
    if (nodes.length >= 2) {
      const first = nodes[0];
      const last  = nodes[nodes.length - 1];
      if (first.tag === 'mo' && last.tag === 'mo') {
        const fTxt = getTextContent(first).trim();
        const lTxt = getTextContent(last).trim();
        const isStretchy = first.attrs.stretchy === 'true' || last.attrs.stretchy === 'true' ||
                           first.attrs.fence === 'true' || last.attrs.fence === 'true';
        if (isStretchy && OPEN_FENCES.has(fTxt) && CLOSE_FENCES.has(lTxt)) {
          const inner = convertChildren(nodes.slice(1, -1), inheritedVariant);
          return `<m:d><m:dPr><m:begChr m:val="${escAttr(fTxt)}"/><m:endChr m:val="${escAttr(lTxt)}"/></m:dPr><m:e>${inner}</m:e></m:d>`;
        }
      }
    }

    let out = '';
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const nary = extractNaryInfo(node);
      if (nary) {
        // Gather following sibling terms up to the next relation/separator as the n-ary operand <m:e>
        const bodyNodes = [];
        let j = i + 1;
        while (j < nodes.length && !isBreakOperator(nodes[j])) {
          bodyNodes.push(nodes[j]);
          j++;
        }
        const subXml = nary.sub ? convertNode(nary.sub, inheritedVariant) : '';
        const supXml = nary.sup ? convertNode(nary.sup, inheritedVariant) : '';
        const bodyXml = bodyNodes.length ? convertChildren(bodyNodes, inheritedVariant) : '';
        let naryPr = `<m:chr m:val="${escAttr(nary.op)}"/><m:limLoc m:val="${nary.limLoc}"/>`;
        if (!nary.sub) naryPr += '<m:subHide m:val="1"/>';
        if (!nary.sup) naryPr += '<m:supHide m:val="1"/>';
        out += `<m:nary><m:naryPr>${naryPr}</m:naryPr><m:sub>${subXml}</m:sub><m:sup>${supXml}</m:sup><m:e>${bodyXml}</m:e></m:nary>`;
        i = j - 1;
        continue;
      }
      out += convertNode(node, inheritedVariant);
    }
    return out;
  }

  // ─── CONVERT SINGLE MATHML NODE ────────────────────────────────────────────
  function convertNode(node, inheritedVariant = null) {
    if (!node) return '';
    if (node.tag === '#text') {
      const t = node.text;
      if (!t || !t.trim()) return '';
      return makeRun(t, styleOptsFromVariant(inheritedVariant, false));
    }

    const variant = (node.attrs && node.attrs.mathvariant) || inheritedVariant;
    const kids = getElementChildren(node);

    switch (node.tag) {
      case 'math':
      case 'mrow':
      case 'mpadded':
      case 'mstyle':
      case 'merror':
      case 'mphantom':
        return convertChildren(kids, variant);

      case 'semantics':
        // Use ONLY the first presentation child; skip <annotation> / <annotation-xml>
        return kids.length ? convertNode(kids[0], variant) : '';

      case 'annotation':
      case 'annotation-xml':
        return '';

      case 'mi': {
        const txt = getTextContent(node);
        // Multi-letter identifiers (cos, sin, tg, log, etc.) or explicit normal variant should be upright
        const isNormal = txt.length > 1 || variant === 'normal';
        return makeRun(txt, styleOptsFromVariant(variant, isNormal));
      }

      case 'mn': {
        const txt = getTextContent(node);
        return makeRun(txt, styleOptsFromVariant(variant, false));
      }

      case 'mo': {
        const txt = getTextContent(node);
        // Map minus/dot operators cleanly
        return makeRun(txt, styleOptsFromVariant(variant, false));
      }

      case 'mtext': {
        const txt = getTextContent(node);
        return makeRun(txt, styleOptsFromVariant(variant, true));
      }

      case 'mspace': {
        const w = (node.attrs && node.attrs.width) || '';
        let sp = '\u2009'; // thin space (\,)
        if (/^1em|^2em/.test(w)) sp = '\u2003';
        else if (/^0\.[4-9]/.test(w)) sp = '\u2002';
        return makeRun(sp, { normal: true });
      }

      case 'mfrac': {
        const num = kids[0] ? convertNode(kids[0], variant) : '';
        const den = kids[1] ? convertNode(kids[1], variant) : '';
        const noBar = node.attrs && node.attrs.linethickness === '0';
        const fPr = noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : '';
        return `<m:f>${fPr}<m:num>${num}</m:num><m:den>${den}</m:den></m:f>`;
      }

      case 'msqrt': {
        const inner = convertChildren(kids, variant);
        return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${inner}</m:e></m:rad>`;
      }

      case 'mroot': {
        const base = kids[0] ? convertNode(kids[0], variant) : '';
        const deg  = kids[1] ? convertNode(kids[1], variant) : '';
        return `<m:rad><m:deg>${deg}</m:deg><m:e>${base}</m:e></m:rad>`;
      }

      case 'msup': {
        const base = kids[0] ? convertNode(kids[0], variant) : '';
        const sup  = kids[1] ? convertNode(kids[1], variant) : '';
        return `<m:sSup><m:e>${base}</m:e><m:sup>${sup}</m:sup></m:sSup>`;
      }

      case 'msub': {
        const base = kids[0] ? convertNode(kids[0], variant) : '';
        const sub  = kids[1] ? convertNode(kids[1], variant) : '';
        return `<m:sSub><m:e>${base}</m:e><m:sub>${sub}</m:sub></m:sSub>`;
      }

      case 'msubsup': {
        const base = kids[0] ? convertNode(kids[0], variant) : '';
        const sub  = kids[1] ? convertNode(kids[1], variant) : '';
        const sup  = kids[2] ? convertNode(kids[2], variant) : '';
        return `<m:sSubSup><m:e>${base}</m:e><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`;
      }

      case 'munder': {
        const base  = kids[0] ? convertNode(kids[0], variant) : '';
        const under = kids[1] ? convertNode(kids[1], variant) : '';
        return `<m:limLow><m:e>${base}</m:e><m:lim>${under}</m:lim></m:limLow>`;
      }

      case 'mover': {
        const base = kids[0] ? convertNode(kids[0], variant) : '';
        const overNode = kids[1];
        const overTxt = overNode ? getTextContent(overNode).trim() : '';
        if (overTxt && Object.prototype.hasOwnProperty.call(ACCENT_MAP, overTxt)) {
          return `<m:acc><m:accPr><m:chr m:val="${escAttr(ACCENT_MAP[overTxt])}"/></m:accPr><m:e>${base}</m:e></m:acc>`;
        }
        const over = overNode ? convertNode(overNode, variant) : '';
        return `<m:limUpp><m:e>${base}</m:e><m:lim>${over}</m:lim></m:limUpp>`;
      }

      case 'munderover': {
        const base  = kids[0] ? convertNode(kids[0], variant) : '';
        const under = kids[1] ? convertNode(kids[1], variant) : '';
        const over  = kids[2] ? convertNode(kids[2], variant) : '';
        return `<m:limUpp><m:e><m:limLow><m:e>${base}</m:e><m:lim>${under}</m:lim></m:limLow></m:e><m:lim>${over}</m:lim></m:limUpp>`;
      }

      case 'mfenced': {
        const open  = (node.attrs && node.attrs.open !== undefined) ? node.attrs.open : '(';
        const close = (node.attrs && node.attrs.close !== undefined) ? node.attrs.close : ')';
        const inner = convertChildren(kids, variant);
        return `<m:d><m:dPr><m:begChr m:val="${escAttr(open)}"/><m:endChr m:val="${escAttr(close)}"/></m:dPr><m:e>${inner}</m:e></m:d>`;
      }

      case 'mtable': {
        const rows = kids.filter(k => k.tag === 'mtr' || k.tag === 'mlabeledtr').map(row => {
          const cells = getElementChildren(row).filter(c => c.tag === 'mtd').map(cell => {
            return `<m:e>${convertChildren(getElementChildren(cell), variant)}</m:e>`;
          }).join('');
          return `<m:mr>${cells}</m:mr>`;
        }).join('');
        return `<m:m>${rows}</m:m>`;
      }

      default:
        return kids.length ? convertChildren(kids, variant) : makeRun(getTextContent(node), { normal: true });
    }
  }

  /**
   * Convert a KaTeX MathML string (with or without outer <span class="katex">)
   * into a clean standalone <math xmlns="http://www.w3.org/1998/Math/MathML"> string
   * (with <annotation> and <semantics> stripped).
   */
  function cleanMathML(katexMathmlHtml, display = false) {
    // Extract just the <math ...>...</math> substring
    const startIdx = katexMathmlHtml.indexOf('<math');
    const endIdx   = katexMathmlHtml.lastIndexOf('</math>');
    if (startIdx === -1 || endIdx === -1) return katexMathmlHtml;
    let ml = katexMathmlHtml.slice(startIdx, endIdx + '</math>'.length);

    // Strip <annotation...>...</annotation> reliably via indexOf loop
    const ANN_OPEN = '<annotation';
    const ANN_CLOSE = '</annotation>';
    let out = '';
    let pos = 0;
    while (pos < ml.length) {
      const oi = ml.indexOf(ANN_OPEN, pos);
      if (oi === -1) { out += ml.slice(pos); break; }
      out += ml.slice(pos, oi);
      const ci = ml.indexOf(ANN_CLOSE, oi);
      if (ci === -1) break;
      pos = ci + ANN_CLOSE.length;
    }
    ml = out;

    // Strip <semantics> and </semantics> tags cleanly (works even with nested <mrow>)
    ml = ml.replace(/<semantics\b[^>]*>/g, '').replace(/<\/semantics>/g, '');

    // Ensure proper MathML namespace
    if (!ml.includes('xmlns=')) {
      ml = ml.replace('<math', '<math xmlns="http://www.w3.org/1998/Math/MathML"');
    }
    if (display && !ml.includes('display=')) {
      ml = ml.replace('<math', '<math display="block"');
    }
    return ml;
  }

  /**
   * Convert Presentation MathML (or KaTeX output:'mathml' string) into
   * Word OMML (<m:oMath ...>...</m:oMath> or <m:oMathPara>...</m:oMathPara>).
   */
  function convertToOMML(mathmlStr, opts = {}) {
    const { display = false, trailingPunct = '' } = opts;
    const cleaned = cleanMathML(mathmlStr, display);
    const tree = parseXmlToTree(cleaned);
    const mathNode = findFirstTag(tree, 'math');
    if (!mathNode) return '';

    let innerOmml = convertNode(mathNode, null);
    if (display && trailingPunct) {
      innerOmml += makeRun(trailingPunct, { normal: true });
    }

    const oMath = `<m:oMath xmlns:m="${OMML_NS}">${innerOmml}</m:oMath>`;
    if (display) {
      return `<m:oMathPara>${oMath}</m:oMathPara>`;
    }
    return oMath;
  }

  /**
   * Wrap OMML in Microsoft Word HTML conditional comment so Word Desktop
   * natively parses it as an editable equation on Ctrl+V.
   */
  function wrapForWordHtml(mathmlStr, opts = {}) {
    const { display = false, trailingPunct = '' } = opts;
    const omml = convertToOMML(mathmlStr, { display, trailingPunct });
    if (!omml) return cleanMathML(mathmlStr, display);
    const cond = `<!--[if gte msEquation 12]>${omml}<![endif]-->`;
    if (display) {
      return `<p class="MsoNormal" align="center" style="text-align:center;margin:6pt 0;">${cond}</p>`;
    }
    return cond;
  }

  return {
    cleanMathML,
    convertToOMML,
    wrapForWordHtml,
  };
});
