import { createRequire } from "node:module";
import PDFDocument from "pdfkit";

const require = createRequire(import.meta.url);
// DejaVu covers Azerbaijani letters (ə, ğ, ı, ş, ç, ö, ü) that the built-in PDF fonts lack.
const fonts = {
  regular: require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf"),
  bold: require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf"),
};

export type Pdf = InstanceType<typeof PDFDocument>;

/** Builds a PDF with `draw` and returns its bytes. */
export function renderPdf(draw: (doc: Pdf) => void, options: { landscape?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, layout: options.landscape ? "landscape" : "portrait" });
    doc.registerFont("regular", fonts.regular);
    doc.registerFont("bold", fonts.bold);
    doc.font("regular");
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      draw(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** A simple table: header row in bold, rows wrap and break across pages. */
export function table(doc: Pdf, header: string[], rows: string[][], widths: number[]) {
  const x0 = doc.page.margins.left;
  const total = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const sum = widths.reduce((a, b) => a + b, 0);
  const cols = widths.map((w) => (w / sum) * total);

  const drawRow = (cells: string[], bold: boolean) => {
    doc.font(bold ? "bold" : "regular").fontSize(9);
    const height = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: cols[i] - 6 }))) + 6;
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    let x = x0;
    cells.forEach((c, i) => {
      doc.text(c, x + 3, y + 3, { width: cols[i] - 6 });
      x += cols[i];
    });
    doc.moveTo(x0, y + height).lineTo(x0 + total, y + height).strokeColor("#cccccc").lineWidth(0.5).stroke();
    doc.x = x0;
    doc.y = y + height;
  };

  drawRow(header, true);
  rows.forEach((r) => drawRow(r, false));
  doc.font("regular");
}
