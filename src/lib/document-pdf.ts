import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import fontAsset from '@/assets/document-font.asset.json';
import { type BusinessDocument, money, documentDate } from './business-document';

// PDF palette is supplied by the semantic document tokens, keeping print and preview consistent.
function color(token: string): [number, number, number] {
  const probe = document.createElement('span');
  probe.style.color = `hsl(var(${token}))`;
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color.match(/[\d.]+/g)?.map(Number);
  probe.remove();
  return rgb && rgb.length >= 3 ? [rgb[0], rgb[1], rgb[2]] : [0, 0, 0];
}
let fontData: Promise<string | null> | undefined;
async function imageData(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Document image could not be loaded');
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image'));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
export async function createDocumentPdf(d: BusinessDocument) {
  fontData ??= fetch(fontAsset.url).then(async r => {
    if (!r.ok) throw new Error('Document font could not be loaded');
    const bytes = new Uint8Array(await r.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }).catch(error => {
    fontData = undefined;
    console.warn('Using built-in PDF font because the custom document font could not be loaded:', error);
    return null;
  });
  const pdf = new jsPDF({ format: 'a4', unit: 'mm' });
  const customFont = await fontData;
  const fontName = customFont ? 'Document' : 'helvetica';
  if (customFont) {
    pdf.addFileToVFS('Document.ttf', customFont);
    pdf.addFont('Document.ttf', 'Document', 'normal');
  }
  pdf.setFont(fontName);
  pdf.setProperties({ title: `${d.kind} ${d.number}`, author: d.company?.company_name || '' });
  const ink = color('--document-ink'), accent = color('--document-accent'), pale = color('--document-tint'), paper = color('--document-paper');
  pdf.setFillColor(...accent); pdf.rect(0, 0, 210, 4, 'F');
  pdf.setTextColor(...ink); pdf.setFontSize(18);
  let brandX = 18;
  if (d.company?.company_logo_url) {
    try {
      const image = await imageData(d.company.company_logo_url);
      const props = pdf.getImageProperties(image); const ratio = Math.min(18 / props.width, 18 / props.height);
      pdf.addImage(image, 18, 15, props.width * ratio, props.height * ratio); brandX = 41;
    } catch (error) {
      console.warn('Omitting the company logo because it could not be loaded:', error);
    }
  }
  const brand = pdf.splitTextToSize(d.company?.company_name || 'Company', 192 - brandX);
  pdf.text(brand, brandX, 22);
  let y = 24 + brand.length * 7;
  pdf.setFontSize(9);
  for (const line of [[d.company?.company_address, d.company?.company_city, d.company?.company_country].filter(Boolean).join(', '), [d.company?.company_phone, d.company?.company_email].filter(Boolean).join(' · '), d.company?.company_tax_id ? `Tax ID: ${d.company.company_tax_id}` : '']) {
    if (!line) continue;
    const lines = pdf.splitTextToSize(line, 174); pdf.text(lines, 18, y); y += lines.length * 5;
  }
  y += 7; pdf.setTextColor(...accent); pdf.setFontSize(17); pdf.text(d.kind === 'invoice' ? 'INVOICE' : 'PAYMENT RECEIPT', 18, y);
  y += 7; pdf.setTextColor(...ink); pdf.setFontSize(10); pdf.text(`${d.number}  ·  ${d.status.replace(/_/g, ' ').toUpperCase()}`, 18, y);
  y += 12;
  const left = [d.kind === 'invoice' ? 'BILL TO' : 'RECEIVED FROM', d.customer?.name || 'Customer unavailable', d.customer?.phone, d.customer?.email, [d.customer?.address_line1, d.customer?.city].filter(Boolean).join(', ')].filter(Boolean).join('\n');
  const right = [`Issued: ${documentDate(d.date)}`, d.dueDate ? `Due: ${documentDate(d.dueDate)}` : '', d.invoiceNumber ? `Invoice: ${d.invoiceNumber}` : '', d.paymentMethod ? `Method: ${d.paymentMethod.replace(/_/g, ' ')}` : ''].filter(Boolean).join('\n');
  autoTable(pdf, { startY: y, body: [[left, right]], theme: 'plain', styles: { font: fontName, fontSize: 9, cellPadding: 3, textColor: ink }, margin: { left: 18, right: 18, bottom: 24 }, columnStyles: { 0: { cellWidth: 99 } } });
  y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  autoTable(pdf, { startY: y, head: [['Description', 'Qty', 'Unit price', 'Amount']], body: d.items.map(item => [item.description, String(item.quantity), money(item.unit_price, d.company), money(item.line_total, d.company)]), theme: 'plain', margin: { left: 18, right: 18, top: 15, bottom: 24 }, styles: { font: fontName, fontSize: 9, cellPadding: 4, textColor: ink, overflow: 'linebreak' }, headStyles: { fillColor: pale, textColor: ink }, columnStyles: { 0: { cellWidth: 78 }, 1: { halign: 'right', cellWidth: 14 }, 2: { halign: 'right', cellWidth: 41 }, 3: { halign: 'right', cellWidth: 41 } } });
  y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  const summary: string[][] = [];
  if (d.kind === 'invoice') {
    summary.push(['Subtotal', money(d.subtotal, d.company)]);
    if (d.discount) summary.push(['Discount', `−${money(d.discount, d.company)}`]);
    if (d.tax) summary.push(['Tax', money(d.tax, d.company)]);
    summary.push(['Total', money(d.total, d.company)], ['Amount paid', money(d.paid, d.company)]);
  }
  summary.push([d.kind === 'receipt' ? 'Payment received' : 'Balance due', money(d.kind === 'receipt' ? d.total : d.balance, d.company)]);
  autoTable(pdf, { startY: y, body: summary, theme: 'plain', margin: { left: 102, right: 18, bottom: 24, top: 15 }, styles: { font: fontName, fontSize: 10, textColor: ink, cellPadding: 3 }, columnStyles: { 1: { halign: 'right' } }, didParseCell: cell => { if (cell.row.index === summary.length - 1) { cell.cell.styles.fillColor = accent; cell.cell.styles.textColor = paper; } } });
  y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  if (d.notes || d.terms) {
    autoTable(pdf, { startY: y, body: [[d.notes ? `Notes\n${d.notes}` : '', d.terms ? `Terms\n${d.terms}` : '']], theme: 'plain', margin: { left: 18, right: 18, top: 15, bottom: 24 }, styles: { font: fontName, fontSize: 9, textColor: ink, cellPadding: 3 } });
    y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }
  if (d.issuer) {
    if (y > 230) { pdf.addPage(); y = 20; }
    if (d.signature) { const props = pdf.getImageProperties(d.signature); pdf.addImage(d.signature, 18, y, 40, Math.min(18, 40 * props.height / props.width)); y += 22; }
    pdf.setFontSize(9); pdf.setTextColor(...ink); pdf.text(pdf.splitTextToSize(`Issued by: ${d.issuer}`, 174), 18, y);
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(...ink);
    pdf.text(pdf.splitTextToSize(`Thank you for choosing ${d.company?.company_name || 'our company'}.`, 174), 18, 276);
    pdf.setFontSize(6); pdf.text(pdf.splitTextToSize(`${d.number}${d.checksum ? ` · Record checksum: ${d.checksum}` : ''}`, 148), 18, 286);
    pdf.text(`${page} / ${pages}`, 192, 286, { align: 'right' });
  }
  return pdf;
}