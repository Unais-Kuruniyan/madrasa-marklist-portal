import { describe, it, expect } from 'vitest';
import { oklchToRgb, normalizeColorString, convertColorToRgb } from './colorNormalization';

describe('colorNormalization', () => {
  it('converts oklch blue to valid rgb string', () => {
    const oklchBlue = 'oklch(0.623 0.214 259.815)';
    const rgb = oklchToRgb(oklchBlue);
    expect(rgb).toMatch(/^rgb\(\d+,\s*\d+,\s*\d+\)$/);
  });

  it('converts oklch with alpha to rgba string', () => {
    const oklchAlpha = 'oklch(0.5 0.1 180 / 0.5)';
    const rgba = oklchToRgb(oklchAlpha);
    expect(rgba).toMatch(/^rgba\(\d+,\s*\d+,\s*\d+,\s*0\.5\)$/);
  });

  it('leaves standard rgb and hex colors unchanged', () => {
    expect(convertColorToRgb('#1e3a8a')).toBe('#1e3a8a');
    expect(convertColorToRgb('rgb(30, 58, 138)')).toBe('rgb(30, 58, 138)');
  });

  it('normalizes embedded oklch strings in CSS declarations', () => {
    const css = 'color: oklch(0.6 0.2 250); background-color: #ffffff;';
    const normalized = normalizeColorString(css);
    expect(normalized).not.toContain('oklch');
    expect(normalized).toContain('rgb(');
    expect(normalized).toContain('background-color: #ffffff');
  });
});
