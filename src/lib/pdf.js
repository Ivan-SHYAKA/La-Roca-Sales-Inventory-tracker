import { jsPDF } from "jspdf";
import { fmt, orderLabel } from "./format";
import { LINES } from "./constants";

function buildInvoicePdf(order, lineLabel) {
  const doc = new jsPDF({ unit: "pt", format: [280, 420 + order.items.length * 16] });
  let y = 36;
  doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text("La Roca", 20, y); y += 20;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`${lineLabel || LINES[order.line].label} · Invoice`, 20, y); y += 18;
  doc.text(`Client: ${orderLabel(order)}`, 20, y); y += 14;
  if (order.phone) { doc.text(`Phone: ${order.phone}`, 20, y); y += 14; }
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Item", 20, y); doc.text("Qty", 175, y); doc.text("Amount", 210, y); y += 12;
  doc.setLineWidth(0.5); doc.line(20, y - 8, 260, y - 8);
  doc.setFont("helvetica", "normal");
  order.items.forEach((it) => {
    doc.text(it.name.slice(0, 26), 20, y);
    doc.text(String(it.qty), 175, y);
    doc.text(fmt(it.price * it.qty), 210, y);
    y += 14;
  });
  y += 4; doc.line(20, y, 260, y); y += 16;
  doc.setFont("helvetica", "bold");
  doc.text(`Total: RWF ${fmt(order.total)}`, 20, y); y += 18;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  if (order.paymentMethod) { doc.text(`Paid: ${order.paymentMethod} · RWF ${fmt(order.amountPaid)} received`, 20, y); y += 12; }
  doc.text(`Placed ${new Date(order.placedAt).toLocaleString()}`, 20, y); y += 12;
  if (order.servedAt) doc.text(`Served ${new Date(order.servedAt).toLocaleString()}`, 20, y);
  return doc;
}

// Prefers the File System Access API so staff pick a folder once (e.g. Desktop/Invoices)
// and the browser defaults back to that same folder on every later save — no repeated
// navigating. Falls back to a plain download for browsers that don't support it
// (Firefox, Safari): those land wherever the browser's own download folder is set.
export async function saveInvoicePdf(order, lineLabel) {
  const doc = buildInvoicePdf(order, lineLabel);
  const blob = doc.output("blob");
  const idPart = (order.tableNumber || order.client || order.id).toString().replace(/[^a-z0-9]+/gi, "-");
  const datePart = new Date(order.billedAt || order.placedAt).toISOString().slice(0, 10);
  const filename = `La-Roca-Invoice-${idPart}-${datePart}.pdf`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      if (e.name === "AbortError") return false;
      throw e;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
