function pdfText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function money(value) {
  return `INR ${Number(value || 0).toFixed(2)}`;
}

export function buildInvoicePdf(invoice, lines) {
  const pageLines = [
    "BRIGHTLOOP SOFTWARE",
    "SUBSCRIPTION INVOICE",
    `Invoice: ${invoice.invoice_number}`,
    `Invoice date: ${invoice.invoice_date}    Due date: ${invoice.due_date}`,
    `Customer: ${invoice.customer_name}`,
    `Email: ${invoice.customer_email || "-"}`,
    `Address: ${invoice.customer_address || "-"}`,
    `Subscription: ${invoice.subscription_number}`,
    `Billing period: ${invoice.period_start} to ${invoice.period_end}`,
    "",
    "ITEMS",
    ...lines.map(
      (line) =>
        `${line.description} | Qty ${line.quantity} | Unit ${money(line.unit_price)} | Tax ${line.tax_rate}% | Total ${money(line.line_total)}`
    ),
    "",
    `Subtotal: ${money(invoice.subtotal)}`,
    `Discount: ${money(invoice.discount_amount)}`,
    `Tax: ${money(invoice.tax_amount)}`,
    `Total: ${money(invoice.total_amount)}`,
    `Paid: ${money(invoice.amount_paid)}`,
    `Balance due: ${money(Number(invoice.total_amount) - Number(invoice.amount_paid))}`,
    `Status: ${invoice.status}`,
  ];

  const perPage = 48;
  const pages = [];
  for (let index = 0; index < pageLines.length; index += perPage) {
    pages.push(pageLines.slice(index, index + perPage));
  }
  if (!pages.length) pages.push([]);

  const objects = new Map();
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);
  const contentObjectIds = pages.map((_, index) => 6 + index * 2);
  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(" ");

  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.set(3, "<< /ProcSet [/PDF /Text] >>");
  objects.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  pages.forEach((linesForPage, index) => {
    const pageId = pageObjectIds[index];
    const contentId = contentObjectIds[index];
    const commands = linesForPage
      .map((line, lineIndex) => {
        const y = 790 - lineIndex * 15;
        const fontSize = lineIndex === 0 && index === 0 ? 16 : 10;
        return `BT /F1 ${fontSize} Tf 48 ${y} Td (${pdfText(line)}) Tj ET`;
      })
      .join("\n");
    const stream = Buffer.from(commands, "ascii");

    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    objects.set(
      contentId,
      `<< /Length ${stream.length} >>\nstream\n${stream.toString("ascii")}\nendstream`
    );
  });

  const maxObjectId = Math.max(...objects.keys());
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let byteLength = chunks[0].length;

  for (let id = 1; id <= maxObjectId; id += 1) {
    offsets[id] = byteLength;
    const object = Buffer.from(`${id} 0 obj\n${objects.get(id)}\nendobj\n`, "ascii");
    chunks.push(object);
    byteLength += object.length;
  }

  const xrefOffset = byteLength;
  const xref = [
    `xref\n0 ${maxObjectId + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF",
  ].join("\n");
  chunks.push(Buffer.from(xref, "ascii"));

  return Buffer.concat(chunks);
}
