/**
 * PDF-Safe Color Normalization for html2canvas.
 * Converts unsupported CSS color functions (oklch, lab, lch) to safe RGB/RGBA/Hex
 * inside the cloned document during PDF generation without altering live website styles.
 */

// Math-based OKLCH to RGB conversion fallback
export function oklchToRgb(oklchStr: string): string {
  try {
    const match = oklchStr.match(/oklch\(\s*([0-9.%]+)\s+([0-9.%]+)\s+([0-9.%]+)(?:\s*\/\s*([0-9.%]+))?\s*\)/i);
    if (!match) return oklchStr;

    const [, lStr, cStr, hStr, aStr] = match;

    const L = lStr.endsWith('%') ? parseFloat(lStr) / 100 : parseFloat(lStr);
    // Chroma in oklch is typically 0..0.4; if percent, 100% = 0.4
    const C = cStr.endsWith('%') ? (parseFloat(cStr) / 100) * 0.4 : parseFloat(cStr);
    const H = parseFloat(hStr);
    const A = aStr ? (aStr.endsWith('%') ? parseFloat(aStr) / 100 : parseFloat(aStr)) : 1;

    if (isNaN(L) || isNaN(C) || isNaN(H)) return 'rgb(0, 0, 0)';

    const hRad = (H * Math.PI) / 180;
    const a = C * Math.cos(hRad);
    const b = C * Math.sin(hRad);

    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;

    const lVal = l_ * l_ * l_;
    const mVal = m_ * m_ * m_;
    const sVal = s_ * s_ * s_;

    const rLin = 4.0767416621 * lVal - 3.3077115913 * mVal + 0.2309699292 * sVal;
    const gLin = -1.2684380046 * lVal + 2.6097574011 * mVal - 0.3413193965 * sVal;
    const bLin = -0.0041960863 * lVal - 0.7034186147 * mVal + 1.707614701 * sVal;

    const gamma = (val: number) => {
      const clamped = Math.max(0, Math.min(1, val));
      return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    };

    const r = Math.round(gamma(rLin) * 255);
    const g = Math.round(gamma(gLin) * 255);
    const bColor = Math.round(gamma(bLin) * 255);

    if (A < 1) {
      return `rgba(${r}, ${g}, ${bColor}, ${Number(A.toFixed(3))})`;
    }
    return `rgb(${r}, ${g}, ${bColor})`;
  } catch {
    return 'rgb(0, 0, 0)';
  }
}

// Convert a single color string using Canvas 2D or fallback converter
export function convertColorToRgb(colorStr: string): string {
  if (!colorStr || typeof colorStr !== 'string') return colorStr;
  if (!/(oklch|lab|lch|color\()/i.test(colorStr)) return colorStr;

  // Try Canvas 2D Context normalization if available
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillStyle = colorStr;
        const normalized = ctx.fillStyle;
        if (normalized && normalized !== '#000000' && !/(oklch|lab|lch|color\()/i.test(normalized)) {
          return normalized;
        }
      }
    } catch {
      // Ignore canvas errors and fall through
    }
  }

  // Fallback to math-based converter for oklch
  if (/oklch/i.test(colorStr)) {
    return oklchToRgb(colorStr);
  }

  // Safe fallback
  return 'rgb(0, 0, 0)';
}

// Replace any oklch(...) occurrences in a string (CSS values, gradients, box-shadows)
export function normalizeColorString(str: string): string {
  if (!str || typeof str !== 'string') return str;
  if (!/(oklch|lab|lch|color\()/i.test(str)) return str;

  return str.replace(/oklch\([^)]+\)/gi, (match) => convertColorToRgb(match));
}

// Color properties to check on elements
const COLOR_PROPERTIES: (keyof CSSStyleDeclaration & string)[] = [
  'color',
  'backgroundColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'boxShadow',
  'fill',
  'stroke',
];

/**
 * Normalizes all styles in a cloned document specifically for html2canvas rendering.
 * Does not affect the active browser DOM or live application theme.
 */
export function normalizeDocumentColorsForPdf(clonedDoc: Document, targetEl?: HTMLElement | null): void {
  try {
    // 1. Process all <style> tags in cloned document
    const styleEls = clonedDoc.querySelectorAll('style');
    styleEls.forEach((styleEl) => {
      if (styleEl.textContent && /(oklch|lab|lch|color\()/i.test(styleEl.textContent)) {
        styleEl.textContent = normalizeColorString(styleEl.textContent);
      }
    });

    // 2. Process all elements inside the cloned document or target element
    const root = targetEl || clonedDoc.body;
    if (!root) return;

    const allElements = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[];
    const win = clonedDoc.defaultView || (typeof window !== 'undefined' ? window : null);

    allElements.forEach((el) => {
      if (!el || !el.style) return;

      const computed = win ? win.getComputedStyle(el) : null;

      COLOR_PROPERTIES.forEach((prop) => {
        const inlineVal = el.style[prop];
        const computedVal = computed ? computed.getPropertyValue(camelToKebab(prop)) || (computed as any)[prop] : '';
        const targetVal = inlineVal || computedVal;

        if (targetVal && typeof targetVal === 'string' && /(oklch|lab|lch|color\()/i.test(targetVal)) {
          const safeVal = normalizeColorString(targetVal);
          (el.style as any)[prop] = safeVal;
        }
      });
    });
  } catch (err) {
    if (import.meta.env?.DEV) {
      console.warn('PDF Color Normalization warning:', err);
    }
  }
}

function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
}
