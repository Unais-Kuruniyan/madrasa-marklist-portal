import { describe, it, expect } from 'vitest';
import { generatePdfFilename } from './generateMarkListPdf';

describe('generatePdfFilename', () => {
  it('generates clean filename with institution, class, exam and year', () => {
    const filename = generatePdfFilename('Darussalam Sunni Madrasa', '9', 'Half-Yearly', 2026);
    expect(filename).toBe('Darussalam-Sunni-Madrasa-Class-9-Half-Yearly-2026.pdf');
  });

  it('handles missing fields gracefully', () => {
    const filename = generatePdfFilename('', '5', '', '');
    expect(filename).toBe('Madrasa-Class-5.pdf');
  });

  it('sanitizes invalid filesystem characters', () => {
    const filename = generatePdfFilename('Madrasa/School & Co.', '6th Standard', 'Annual/Final!', '2026');
    expect(filename).toBe('MadrasaSchool-Co-Class-6th-Standard-AnnualFinal-2026.pdf');
  });
});
