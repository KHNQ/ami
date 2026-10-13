import { config } from "../config.js";
import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { createPdf } from "../lib/pdfDoc.js";
import { settingsService } from "./settingsService.js";

// The proforma a visitor downloads the moment they ask for a price.
//
// This is the document the whole in-person flow turns on: the customer walks
// into the office holding it, and the reference on it is what the staff
// member searches for. So it is generated from the stored quote row at
// download time -- never from anything the browser sends -- and it says
// plainly what it is and is not, because a proforma that reads like an
// invoice is a document somebody will try to pay against.

const money = (cents, currency = "USD") =>
  `${currency === "USD" ? "$" : `${currency} `}${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const date = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export const proformaService = {
  /**
   * Fetches a quote for download.
   *
   * Takes BOTH the id and the reference, and requires them to match. The
   * customer is anonymous -- they have no token and no account -- so the two
   * together are the capability: the id alone is guessable in principle, and
   * handing out a document with someone's name, clinic and the price they
   * were given on the strength of a guessed id is not acceptable.
   */
  getForDownload(id, reference) {
    const quote = db.salesQuotes.get(id);
    if (!quote) throw Errors.notFound("Proforma not found");
    if (!reference || quote.reference !== String(reference).trim().toUpperCase()) {
      // Deliberately the same error as a missing row: a different message
      // here would confirm that the id exists.
      throw Errors.notFound("Proforma not found");
    }
    return quote;
  },

  filename(quote) {
    return `proforma-${quote.reference}.pdf`;
  },

  /** The document itself. Returns PDF bytes. */
  render(quote) {
    const product = quote.product_id ? db.products.get(quote.product_id) : null;
    const showPrices = settingsService.isEnabled("show_prices");
    const amountCents = quote.amount_cents ?? product?.list_price_y_cents ?? null;
    const currency = quote.currency || "USD";
    const isLease = quote.term_months != null && quote.instalment_cents != null;

    const doc = createPdf({ title: `Proforma ${quote.reference}` });

    // --- header ---
    doc.text(config.companyName, { size: 17, font: "bold" });
    doc.text("Medical aesthetic equipment · Tehran, Iran", { size: 9, color: [0.4, 0.4, 0.4] });
    doc.space(10);

    doc.text("PROFORMA INVOICE", { size: 22, font: "bold" });
    doc.space(2);
    doc.rule();
    doc.space(6);

    // --- the two facts a staff member looks for first ---
    doc.text(`Reference    ${quote.reference}`, { size: 11, font: "bold" });
    doc.text(`Issued       ${date(quote.created_at)}`, { size: 10 });
    if (quote.locked_until) {
      doc.text(`Valid until  ${date(quote.locked_until)}`, { size: 10 });
    }
    doc.space(8);

    // --- who it is for ---
    doc.text("PREPARED FOR", { size: 8, font: "bold", color: [0.45, 0.45, 0.45] });
    doc.text(quote.contact_name || "—", { size: 11, font: "bold" });
    const whereLine = [quote.clinic_city, quote.specialty].filter(Boolean).join(" · ");
    if (whereLine) doc.text(whereLine, { size: 9, color: [0.4, 0.4, 0.4] });
    if (quote.contact_email) doc.text(quote.contact_email, { size: 9, color: [0.4, 0.4, 0.4] });
    if (quote.contact_phone) doc.text(quote.contact_phone, { size: 9, color: [0.4, 0.4, 0.4] });
    doc.space(12);

    // --- what it is for ---
    doc.box({ height: 22 });
    doc.text("ITEM", { size: 8, font: "bold", color: [0.3, 0.3, 0.3] });
    doc.textRight("AMOUNT", { size: 8, font: "bold", color: [0.3, 0.3, 0.3], y: doc.y + 14.5 });
    doc.space(2);
    doc.rule();

    const itemName = product?.name || quote.subject || "Equipment enquiry";
    doc.text(itemName, { size: 11, font: "bold" });
    if (showPrices && amountCents != null) {
      doc.textRight(money(amountCents, currency), { size: 11, font: "bold", y: doc.y + 15.95 });
    } else {
      doc.textRight("On request", { size: 10, color: [0.4, 0.4, 0.4], y: doc.y + 15.95 });
    }
    if (quote.bundle) doc.text(quote.bundle, { size: 9, color: [0.4, 0.4, 0.4] });
    if (quote.notes) doc.paragraph(quote.notes, { size: 9 });
    doc.space(6);
    doc.rule();

    if (showPrices && amountCents != null) {
      doc.space(4);
      doc.text("TOTAL", { size: 11, font: "bold" });
      doc.textRight(money(amountCents, currency), { size: 14, font: "bold", y: doc.y + 15.95 });
      doc.space(4);
      doc.rule();
    }

    // --- lease terms, exactly as requested -------------------------------
    if (isLease && showPrices) {
      doc.space(8);
      doc.text("LEASE TERMS (INDICATIVE)", { size: 8, font: "bold", color: [0.45, 0.45, 0.45] });
      doc.space(2);
      doc.text(`Term              ${quote.term_months} months`, { size: 10 });
      if (quote.upfront_pct != null) {
        doc.text(`Upfront payment   ${money(quote.deposit_cents ?? 0, currency)} (${quote.upfront_pct}%)`, { size: 10 });
      }
      doc.text(`Instalment        ${money(quote.instalment_cents, currency)} / month`, { size: 10, font: "bold" });
      if (quote.apr_bp != null) {
        doc.text(`Rate (APR)        ${(quote.apr_bp / 100).toFixed(2)}%`, { size: 10 });
      }
      doc.paragraph(
        "Final lease terms are confirmed by our sales team and the leasing partner when the agreement is drawn up.",
        { size: 8, color: [0.45, 0.45, 0.45] }
      );
      doc.space(4);
      doc.rule();
    }

    if (quote.locked_rate) {
      doc.space(4);
      doc.text(`Rate locked at ${Number(quote.locked_rate).toLocaleString("en-US")} IRR/EUR`, {
        size: 9,
        color: [0.4, 0.4, 0.4],
      });
    }

    // --- what happens next, in the customer's words ---
    doc.space(14);
    doc.text("HOW TO COMPLETE THIS PURCHASE", { size: 8, font: "bold", color: [0.45, 0.45, 0.45] });
    doc.space(2);
    doc.paragraph(
      "1. Our team will contact you to answer questions and arrange a demonstration.",
      { size: 9, color: [0.25, 0.25, 0.25] }
    );
    doc.paragraph(
      "2. Visit our office to see the device. Bring this proforma, or simply quote the reference above.",
      { size: 9, color: [0.25, 0.25, 0.25] }
    );
    doc.paragraph(
      "3. Payment is completed in person. If a colleague referred you, give us their invite code at that " +
        "point so the referral is recorded against your purchase.",
      { size: 9, color: [0.25, 0.25, 0.25] }
    );

    // --- the disclaimer that keeps this a quotation ---
    doc.space(14);
    doc.rule();
    doc.space(4);
    doc.paragraph(
      "This is a proforma invoice: a quotation issued on request. It is not a tax invoice, not a demand " +
        "for payment, and no goods are reserved by it. Prices are subject to confirmation at the time of " +
        "sale and to currency movement unless a rate lock is stated above.",
      { size: 7.5, color: [0.5, 0.5, 0.5] }
    );
    doc.text(`${config.companyName} · ${quote.reference}`, { size: 7.5, color: [0.55, 0.55, 0.55] });

    return doc.build();
  },
};
