import ExcelJS from "exceljs";

/*
 * A preview of an Excel file HR is about to download: the file itself is built first, then read back, so what the preview shows is exactly what the file holds
 * (the same sheets, headings and cells). Every sheet has its title on row 1, a note on row 2 and its headings on row 3. At most `maxRows` rows of each sheet are
 * returned; `total` says how many there are, so the page can say "showing 50 of 214".
 */
const text = (v) => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return String(v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join("") : ""));
  return String(v);
};

export async function previewOf(buffer, { maxRows = 100 } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return {
    sheets: wb.worksheets.map((ws) => {
      const columns = ws.getRow(3).values.slice(1).map(text);
      const rows = [];
      let total = 0;
      ws.eachRow((row, n) => {
        if (n <= 3) return;
        const cells = columns.map((_, i) => text(row.getCell(i + 1).value));
        if (!cells.some(Boolean) || (cells.length > 1 && cells.slice(1).every((c) => !c) && cells[0] === "Nothing to show.")) return;
        total++;
        if (rows.length < maxRows) rows.push(cells);
      });
      return { name: ws.name, note: text(ws.getCell(2, 1).value), columns, rows, total };
    }),
  };
}
