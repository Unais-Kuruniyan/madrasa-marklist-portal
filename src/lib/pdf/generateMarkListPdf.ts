import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import type { ClassDetail } from '../../types';
import { calculateSummary, evaluateStudent, formatCombinedCount, isPassingMark } from '../calculations/marks';
import { formatMark, formatPercent } from '../../utils/format';
import { normalizeDocumentColorsForPdf } from './colorNormalization';

export function generatePdfFilename(
  institutionName?: string,
  className?: string,
  examName?: string,
  examYear?: string | number,
): string {
  const parts = [
    institutionName || 'Madrasa',
    className ? `Class-${className}` : '',
    examName || '',
    examYear ? String(examYear) : '',
  ].filter(Boolean);

  const raw = parts.join('-');
  const sanitized = raw
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${sanitized || 'Mark-List'}.pdf`;
}

interface GeneratePdfOptions {
  data: ClassDetail;
  orientation: 'portrait' | 'landscape';
  t: (key: string, params?: Record<string, string | number>) => string;
}

export async function generateMarkListPdf({ data, orientation, t }: GeneratePdfOptions): Promise<void> {
  const { schoolClass, examination, config, students } = data;
  const withQH = config.includeQuranHifz && !!config.quranSubject && !!config.hifzSubject;

  const evaluated = students.map((s) => evaluateStudent(config, s));
  const summary = calculateSummary(schoolClass.totalStudents, evaluated);

  const boysGroup = students
    .filter((s) => s.category === 'boys')
    .map((s) => ({ student: s, result: evaluateStudent(config, s) }));

  const girlsGroup = students
    .filter((s) => s.category === 'girls')
    .map((s) => ({ student: s, result: evaluateStudent(config, s) }));

  const colSpanCount = 1 + 1 + (config.normalSubjects.length || 0) + (withQH ? 3 : 0) + 1 + 1;

  // Build items list
  type TableItem =
    | { type: 'section-header'; label: string; category: 'boys' | 'girls'; count: number }
    | { type: 'student'; student: (typeof students)[0]; result: (typeof evaluated)[0] };

  const items: TableItem[] = [];
  if (boysGroup.length > 0) {
    items.push({
      type: 'section-header',
      label: `── ${t('student.boys').toUpperCase()} (${boysGroup.length}) ──`,
      category: 'boys',
      count: boysGroup.length,
    });
    boysGroup.forEach((b) => items.push({ type: 'student', student: b.student, result: b.result }));
  }
  if (girlsGroup.length > 0) {
    items.push({
      type: 'section-header',
      label: `── ${t('student.girls').toUpperCase()} (${girlsGroup.length}) ──`,
      category: 'girls',
      count: girlsGroup.length,
    });
    girlsGroup.forEach((g) => items.push({ type: 'student', student: g.student, result: g.result }));
  }

  // Calculate items per page
  // Page 1 has top header + table header
  // Subsequent pages have repeated table header
  const maxRowsPage1 = orientation === 'landscape' ? 14 : 22;
  const maxRowsPageOther = orientation === 'landscape' ? 18 : 28;
  const summaryHeightInRows = 6; // Reserve space for summary & signatures

  const pagesItems: TableItem[][] = [];
  let currentItems: TableItem[] = [];
  let currentMax = maxRowsPage1;

  let i = 0;
  while (i < items.length) {
    const item = items[i];

    // Avoid orphan section header at end of page
    if (item.type === 'section-header') {
      const remainingCapacity = currentMax - currentItems.length;
      if (remainingCapacity < 2) {
        // Not enough space for section header + at least 1 student row
        pagesItems.push(currentItems);
        currentItems = [];
        currentMax = maxRowsPageOther;
        continue;
      }
    }

    if (currentItems.length >= currentMax) {
      pagesItems.push(currentItems);
      currentItems = [];
      currentMax = maxRowsPageOther;
      continue;
    }

    currentItems.push(item);
    i++;
  }

  if (currentItems.length > 0) {
    pagesItems.push(currentItems);
  }

  // If no items at all (empty student list)
  if (pagesItems.length === 0) {
    pagesItems.push([]);
  }

  // Check if final page has room for Summary + Signatures
  const lastPageIndex = pagesItems.length - 1;
  const lastPageCapacity = lastPageIndex === 0 ? maxRowsPage1 : maxRowsPageOther;
  const needExtraPageForSummary = pagesItems[lastPageIndex].length + summaryHeightInRows > lastPageCapacity;

  // Render hidden HTML container
  const renderRoot = document.createElement('div');
  renderRoot.id = 'pdf-render-root';
  renderRoot.style.position = 'fixed';
  renderRoot.style.top = '-10000px';
  renderRoot.style.left = '-10000px';
  renderRoot.style.width = orientation === 'landscape' ? '297mm' : '210mm';
  renderRoot.style.backgroundColor = '#ffffff';
  renderRoot.style.fontFamily = '"Noto Sans Malayalam", "Inter", sans-serif';
  renderRoot.style.color = '#000000';
  document.body.appendChild(renderRoot);

  try {
    const pageElements: HTMLElement[] = [];

    // Helper to render table header HTML string
    const getTableHeaderHtml = () => `
      <thead>
        <tr style="background-color: #f1f5f9; font-weight: 700; text-align: center; vertical-align: middle;">
          <th style="border: 1px solid #000; padding: 5px 4px; font-size: 11px; width: 45px;">${t('student.rollNumber')}</th>
          <th style="border: 1px solid #000; padding: 5px 8px; font-size: 11px; text-align: left; min-width: 140px;">${t('student.name')}</th>
          ${config.normalSubjects
            .map(
              (subj) => `<th style="border: 1px solid #000; padding: 5px 4px; font-size: 11px; min-width: 55px;">${subj.name}</th>`,
            )
            .join('')}
          ${
            withQH
              ? `
            <th style="border: 1px solid #000; padding: 5px 4px; font-size: 11px; min-width: 50px;">${t('student.quranLabel')}</th>
            <th style="border: 1px solid #000; padding: 5px 4px; font-size: 11px; min-width: 50px;">${t('student.hifzLabel')}</th>
            <th style="border: 1px solid #000; padding: 5px 4px; font-size: 11px; min-width: 75px; background-color: #e2e8f0;">${t('student.quranHifzLabel')}</th>
          `
              : ''
          }
          <th style="border: 1px solid #000; padding: 5px 4px; font-size: 11px; min-width: 75px; background-color: #e2e8f0;">${t('results.grandTotal')}</th>
          <th style="border: 1px solid #000; padding: 5px 4px; font-size: 11px; width: 55px;">${t('results.result')}</th>
        </tr>
      </thead>
    `;

    // Helper to render student row HTML string
    const getStudentRowHtml = (student: (typeof students)[0], res: (typeof evaluated)[0]) => {
      const normalCells = config.normalSubjects
        .map((_, idx) => {
          const m = res.normalMarks[idx];
          const fail = m !== null && !isPassingMark(m);
          return `
            <td style="border: 1px solid #000; padding: 4px 5px; text-align: center; font-weight: ${fail ? '700' : '500'}; color: ${fail ? '#b91c1c' : '#1e293b'}; background-color: ${fail ? '#fef2f2' : 'transparent'}; font-size: 11px;">
              ${formatMark(m)}
            </td>
          `;
        })
        .join('');

      const qhCells = withQH
        ? `
          <td style="border: 1px solid #000; padding: 4px 5px; text-align: center; font-weight: 500; font-size: 11px;">${formatMark(res.quran)}</td>
          <td style="border: 1px solid #000; padding: 4px 5px; text-align: center; font-weight: 500; font-size: 11px;">${formatMark(res.hifz)}</td>
          <td style="border: 1px solid #000; padding: 4px 5px; text-align: center; font-weight: 700; font-size: 11px; color: ${res.quranHifzTotal !== null && !isPassingMark(res.quranHifzTotal) ? '#b91c1c' : '#0f172a'}; background-color: ${res.quranHifzTotal !== null && !isPassingMark(res.quranHifzTotal) ? '#fef2f2' : '#f8fafc'};">
            ${formatMark(res.quranHifzTotal)}
          </td>
        `
        : '';

      const resColor = res.result === 'P' ? '#15803d' : res.result === 'F' ? '#dc2626' : '#64748b';

      return `
        <tr style="break-inside: avoid; page-break-inside: avoid;">
          <td style="border: 1px solid #000; padding: 4px 5px; text-align: center; font-weight: 600; font-size: 11px;">${student.rollNumber}</td>
          <td style="border: 1px solid #000; padding: 4px 8px; text-align: left; font-weight: 500; font-size: 11px;">${student.studentName}</td>
          ${normalCells}
          ${qhCells}
          <td style="border: 1px solid #000; padding: 4px 5px; text-align: center; font-weight: 700; font-size: 11px; color: #0f172a;">${formatMark(res.grandTotal)}</td>
          <td style="border: 1px solid #000; padding: 4px 5px; text-align: center; font-weight: 700; font-size: 11px; color: ${resColor};">
            ${res.result ?? (res.status === 'absent' ? 'AB' : '-')}
          </td>
        </tr>
      `;
    };

    // Render each page
    for (let pIndex = 0; pIndex < pagesItems.length; pIndex++) {
      const pageItems = pagesItems[pIndex];
      const isFirstPage = pIndex === 0;
      const isLastContentPage = pIndex === pagesItems.length - 1 && !needExtraPageForSummary;

      const pageEl = document.createElement('div');
      pageEl.className = 'pdf-page-container';
      pageEl.style.width = orientation === 'landscape' ? '297mm' : '210mm';
      pageEl.style.minHeight = orientation === 'landscape' ? '210mm' : '297mm';
      pageEl.style.padding = orientation === 'landscape' ? '10mm 12mm' : '12mm 12mm';
      pageEl.style.boxSizing = 'border-box';
      pageEl.style.backgroundColor = '#ffffff';
      pageEl.style.display = 'flex';
      pageEl.style.flexDirection = 'column';
      pageEl.style.justifyContent = 'space-between';

      let pageHeaderHtml = '';
      if (isFirstPage) {
        pageHeaderHtml = `
          <div style="position: relative; margin-bottom: 16px; padding-top: 4px; padding-bottom: 8px; border-bottom: 2px solid #000000;">
            <!-- Class Box on Right -->
            <div style="position: absolute; right: 0; top: 0; border: 2px solid #000000; padding: 4px 14px; background-color: #f8fafc; text-align: center; min-width: 90px;">
              <span style="display: block; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #475569;">${t('print.classBoxLabel')}</span>
              <strong style="font-size: 18px; font-weight: 800; text-transform: uppercase; color: #000000; font-family: sans-serif;">${schoolClass.className}</strong>
            </div>

            <div style="text-align: center; padding-right: 110px; padding-left: 10px;">
              <h1 style="font-size: 20px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #000000; margin: 0;">
                ${schoolClass.institutionName || t('print.defaultTitle')}
              </h1>

              <div style="margin-top: 4px; font-size: 11px; font-weight: 500; color: #334155; display: flex; align-items: center; justify-content: center; gap: 16px;">
                ${schoolClass.institutionLocation ? `<span>${t('print.locationLabel')} ${schoolClass.institutionLocation}</span>` : ''}
                ${schoolClass.rangeName ? `<span>${t('print.rangeLabel')} ${schoolClass.rangeName}</span>` : ''}
              </div>

              <div style="margin-top: 6px; display: inline-block; border-bottom: 1px solid #000000; padding-bottom: 2px;">
                <h2 style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #000000; margin: 0;">
                  ${examination.examName} — ${examination.examYear}
                </h2>
              </div>
            </div>
          </div>
        `;
      } else {
        // Page 2+ header
        pageHeaderHtml = `
          <div style="margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #94a3b8; display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: 600; color: #475569;">
            <span>${schoolClass.institutionName || t('print.defaultTitle')} — ${examination.examName} (${examination.examYear})</span>
            <span>${t('print.classBoxLabel')} ${schoolClass.className}</span>
          </div>
        `;
      }

      let rowsHtml = '';
      if (students.length === 0) {
        rowsHtml = `
          <tr>
            <td colspan="${colSpanCount}" style="border: 1px solid #000; text-align: center; padding: 20px; font-style: italic; color: #64748b; font-size: 11px;">
              ${t('print.noStudents')}
            </td>
          </tr>
        `;
      } else {
        rowsHtml = pageItems
          .map((item) => {
            if (item.type === 'section-header') {
              const bg = item.category === 'boys' ? '#f1f5f9' : '#fdf2f8';
              return `
                <tr style="background-color: ${bg}; font-weight: 700; text-transform: uppercase; font-size: 10px; break-inside: avoid; page-break-inside: avoid;">
                  <td colspan="${colSpanCount}" style="border: 1px solid #000; padding: 4px 8px; text-align: left;">
                    ${item.label}
                  </td>
                </tr>
              `;
            }
            return getStudentRowHtml(item.student, item.result);
          })
          .join('');
      }

      let summaryAndSignatureHtml = '';
      if (isLastContentPage) {
        summaryAndSignatureHtml = getSummaryAndSignatureHtml(summary, t);
      }

      pageEl.innerHTML = `
        <div>
          ${pageHeaderHtml}
          <div style="margin-bottom: 12px;">
            <table style="width: 100%; border-collapse: collapse; border: 1px solid #000000;">
              ${getTableHeaderHtml()}
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
          ${summaryAndSignatureHtml}
        </div>
      `;

      renderRoot.appendChild(pageEl);
      pageElements.push(pageEl);
    }

    // If extra page needed for Summary + Signatures
    if (needExtraPageForSummary) {
      const extraPageEl = document.createElement('div');
      extraPageEl.className = 'pdf-page-container';
      extraPageEl.style.width = orientation === 'landscape' ? '297mm' : '210mm';
      extraPageEl.style.minHeight = orientation === 'landscape' ? '210mm' : '297mm';
      extraPageEl.style.padding = orientation === 'landscape' ? '10mm 12mm' : '12mm 12mm';
      extraPageEl.style.boxSizing = 'border-box';
      extraPageEl.style.backgroundColor = '#ffffff';
      extraPageEl.style.display = 'flex';
      extraPageEl.style.flexDirection = 'column';
      extraPageEl.style.justifyContent = 'space-between';

      extraPageEl.innerHTML = `
        <div>
          <div style="margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #94a3b8; display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: 600; color: #475569;">
            <span>${schoolClass.institutionName || t('print.defaultTitle')} — ${examination.examName} (${examination.examYear})</span>
            <span>${t('print.classBoxLabel')} ${schoolClass.className}</span>
          </div>
          ${getSummaryAndSignatureHtml(summary, t)}
        </div>
      `;
      renderRoot.appendChild(extraPageEl);
      pageElements.push(extraPageEl);
    }

    // Convert each page element to high resolution canvas and add to jsPDF
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const pdfWidth = orientation === 'landscape' ? 297 : 210;
    const pdfHeight = orientation === 'landscape' ? 210 : 297;

    for (let index = 0; index < pageElements.length; index++) {
      if (index > 0) {
        pdf.addPage('a4', orientation);
      }

      const canvas = await html2canvas(pageElements[index], {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        onclone: (clonedDoc: Document, clonedEl: HTMLElement) => {
          normalizeDocumentColorsForPdf(clonedDoc, clonedEl);
        },
      });

      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
    }

    const filename = generatePdfFilename(
      schoolClass.institutionName,
      schoolClass.className,
      examination.examName,
      examination.examYear,
    );

    pdf.save(filename);
  } finally {
    if (renderRoot.parentNode) {
      renderRoot.parentNode.removeChild(renderRoot);
    }
  }
}

function getSummaryAndSignatureHtml(
  summary: ReturnType<typeof calculateSummary>,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  return `
    <!-- Result Summary Box -->
    <div style="border: 1px solid #000000; padding: 10px 12px; margin-top: 14px; margin-bottom: 16px; background-color: #f8fafc;">
      <h3 style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #000000; padding-bottom: 4px; margin: 0 0 8px 0;">
        ${t('results.summary')}
      </h3>
      <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; text-align: center; font-size: 11px;">
        <div>
          <span style="display: block; color: #475569; font-weight: 500;">${t('results.totalParticipants')}</span>
          <strong style="font-size: 12px; font-weight: 700; color: #000000; font-family: sans-serif;">
            ${formatCombinedCount(summary.totalBoys, summary.totalGirls, summary.totalParticipants)}
          </strong>
        </div>
        <div>
          <span style="display: block; color: #475569; font-weight: 500;">${t('results.appeared')}</span>
          <strong style="font-size: 12px; font-weight: 700; color: #000000; font-family: sans-serif;">
            ${formatCombinedCount(summary.appearedBoys, summary.appearedGirls, summary.totalAppeared)}
          </strong>
        </div>
        <div>
          <span style="display: block; color: #475569; font-weight: 500;">${t('results.passed')}</span>
          <strong style="font-size: 12px; font-weight: 700; color: #15803d; font-family: sans-serif;">
            ${formatCombinedCount(summary.passedBoys, summary.passedGirls, summary.totalPassed)}
          </strong>
        </div>
        <div>
          <span style="display: block; color: #475569; font-weight: 500;">${t('results.failed')}</span>
          <strong style="font-size: 12px; font-weight: 700; color: #b91c1c; font-family: sans-serif;">
            ${formatCombinedCount(summary.failedBoys, summary.failedGirls, summary.totalFailed)}
          </strong>
        </div>
        <div>
          <span style="display: block; color: #475569; font-weight: 500;">${t('results.passPercentage')}</span>
          <strong style="font-size: 12px; font-weight: 800; color: #000000; font-family: sans-serif;">
            ${formatPercent(summary.passPercentage)}
          </strong>
        </div>
      </div>
    </div>

    <!-- Signature Section -->
    <div style="margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; font-size: 11px; padding-top: 10px; border-top: 1px solid #cbd5e1;">
      <div style="text-align: left; display: flex; flex-direction: column; gap: 20px;">
        <p style="margin: 0; font-weight: 500;">${t('print.date')}: ________________________</p>
        <p style="margin: 0; font-weight: 600;">${t('print.teacherSignature')}: ________________________________</p>
      </div>
      <div style="text-align: right; display: flex; flex-direction: column; gap: 20px;">
        <p style="margin: 0; font-weight: 500;">${t('print.sealStamp')}</p>
        <p style="margin: 0; font-weight: 600;">${t('print.principalSignature')}: ________________________________</p>
      </div>
    </div>
  `;
}
