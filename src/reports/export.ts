import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { Report } from './build';
import { downloadBlob, stamp } from '../ui/download';

const ascii = (v: unknown) => String(v).replace(/m³/g, 'm3').replace(/²/g, '2').replace(/Σ/g, 'Sum').replace(/·/g, '*').replace(/×/g, 'x').replace(/÷/g, '/').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/−/g, '-').replace(/→/g, '->').replace(/[“”]/g, '"').replace(/—/g, '-').replace(/[^\x20-\x7E]/g, '');

export function exportPDF(rep: Report) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = 40;
  doc.setFontSize(15); doc.text(ascii(rep.title), 36, y); y += 18;
  doc.setFontSize(9); doc.setTextColor(90);
  doc.text(ascii(`Generated ${new Date(rep.generatedISO).toLocaleString('en-GB', { hour12: false })}. ${rep.simInfo}`), 36, y, { maxWidth: W - 72 }); y += 26;
  doc.setTextColor(0);
  for (const s of rep.sections) {
    if (y > 520) { doc.addPage(); y = 40; }
    doc.setFontSize(11); doc.text(ascii(s.heading), 36, y); y += 12;
    doc.setFontSize(8.5);
    for (const p of s.paragraphs ?? []) {
      const lines = doc.splitTextToSize(ascii(p), W - 72);
      if (y + lines.length * 11 > 560) { doc.addPage(); y = 40; }
      doc.text(lines, 36, y); y += lines.length * 11 + 2;
    }
    if (s.table) {
      autoTable(doc, {
        startY: y, head: [s.table.head.map(ascii)], body: s.table.rows.length ? s.table.rows.map((r) => r.map(ascii)) : [['(none)']],
        styles: { fontSize: 7, cellPadding: 2.5 }, headStyles: { fillColor: [30, 42, 55] }, margin: { left: 36, right: 36 },
      });
      y = (doc as any).lastAutoTable.finalY + 16;
    } else y += 6;
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(120); doc.text(`Page ${i} of ${n} - advisory simulation report`, 36, doc.internal.pageSize.getHeight() - 16); }
  downloadBlob(`${rep.id}-report-${stamp()}.pdf`, doc.output('blob'));
}

export function exportXLSX(rep: Report) {
  const wb = XLSX.utils.book_new();
  const cover: (string | number)[][] = [[rep.title], ['Generated', rep.generatedISO], ['Simulation', rep.simInfo], []];
  rep.sections.forEach((s, i) => { cover.push([`${i + 1}. ${s.heading}`]); (s.paragraphs ?? []).forEach((p) => cover.push(['', p])); });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cover), 'Summary');
  const used = new Set<string>(['Summary']);
  rep.sections.forEach((s, i) => {
    if (!s.table) return;
    let name = `${i + 1} ${s.heading}`.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
    while (used.has(name)) name = name.slice(0, 28) + Math.floor(Math.random() * 99);
    used.add(name);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([s.table.head, ...s.table.rows]), name);
  });
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  downloadBlob(`${rep.id}-report-${stamp()}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
