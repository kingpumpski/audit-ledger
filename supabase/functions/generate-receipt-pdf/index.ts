import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept, x-supabase-api-version",
  "Access-Control-Max-Age": "86400",
};

interface ReceiptData {
  receiptId?: unknown;
}

interface ReceiptRecord {
  receipt_number: string;
  issue_date: string;
  status: string;
  payment_method: string;
  amount: number | string;
  issuer_name: string;
  signature_data: string | null;
  checksum: string | null;
  notes: string | null;
  customer: {
    name: string | null;
    email: string | null;
    phone: string | null;
    address_line1: string | null;
    city: string | null;
  } | null;
  invoice: {
    invoice_number: string;
    subtotal: number | string | null;
    discount_amount: number | string | null;
    tax_amount: number | string | null;
    total_amount: number | string | null;
    amount_paid: number | string | null;
    balance_due: number | string | null;
    items: Array<{
      description: string;
      quantity: number | string;
      unit_price: number | string;
      discount_type: string | null;
      discount_value: number | string | null;
      tax_rate: number | string | null;
      tax_amount: number | string | null;
      line_total: number | string;
    }>;
    invoice_taxes: Array<{
      tax_rate: number | string;
      taxable_amount: number | string;
      tax_amount: number | string;
      tax: { name: string; code: string } | null;
    }>;
  } | null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function safeSignatureDataUrl(value: string | null): string | null {
  if (!value || value.length > 1_000_000) return null;
  // SignaturePad stores canvas PNG data URLs. Do not allow arbitrary URL or HTML schemes.
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(value) ? value : null;
}

function formatAmount(value: number | string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Receipt contains an invalid amount.");
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderReceipt(receipt: ReceiptRecord, currencySymbol: string, companyName: string): string {
  const status = receipt.status === "issued" ? "issued" : "void";
  const statusLabel = status === "issued" ? "Issued" : "Void";
  const date = new Date(receipt.issue_date);
  const issueDate = Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const signature = safeSignatureDataUrl(receipt.signature_data);
  const amount = formatAmount(receipt.amount);
  const paymentMethod = escapeHtml(receipt.payment_method.replace(/_/g, " "));
  const invoiceNumber = receipt.invoice?.invoice_number
    ? escapeHtml(receipt.invoice.invoice_number)
    : null;
  const invoice = receipt.invoice;
  const invoiceItemsHtml = invoice?.items?.map(item => {
    const discount = Number(item.discount_value || 0);
    const discountLabel = discount > 0
      ? item.discount_type === "percentage" ? `${formatAmount(discount)}%` : `${currencySymbol} ${formatAmount(discount)}`
      : "—";
    return `<tr>
      <td>${escapeHtml(item.description)}</td>
      <td style="text-align:center">${escapeHtml(item.quantity)}</td>
      <td style="text-align:right">${currencySymbol} ${formatAmount(item.unit_price)}</td>
      <td style="text-align:right">${discountLabel}</td>
      <td style="text-align:right">${currencySymbol} ${formatAmount(item.line_total)}</td>
    </tr>`;
  }).join("") || "";
  const taxBreakdownHtml = invoice?.invoice_taxes?.map(tax => `<tr>
    <td>${escapeHtml(tax.tax?.name || tax.tax?.code || "Tax")}</td>
    <td style="text-align:right">${formatAmount(tax.tax_rate)}%</td>
    <td style="text-align:right">${currencySymbol} ${formatAmount(tax.taxable_amount)}</td>
    <td style="text-align:right">${currencySymbol} ${formatAmount(tax.tax_amount)}</td>
  </tr>`).join("") || "";
  const invoiceSummaryHtml = invoice ? `
    <table class="summary-table">
      <tbody>
        <tr><td>Subtotal</td><td>${currencySymbol} ${formatAmount(invoice.subtotal || 0)}</td></tr>
        <tr><td>Discount</td><td>− ${currencySymbol} ${formatAmount(invoice.discount_amount || 0)}</td></tr>
        <tr><td>Total taxes</td><td>${currencySymbol} ${formatAmount(invoice.tax_amount || 0)}</td></tr>
        <tr class="summary-total"><td>Invoice total</td><td>${currencySymbol} ${formatAmount(invoice.total_amount || 0)}</td></tr>
        <tr><td>Received on this receipt</td><td>${currencySymbol} ${amount}</td></tr>
        <tr><td>Paid to date</td><td>${currencySymbol} ${formatAmount(invoice.amount_paid || 0)}</td></tr>
        <tr class="summary-balance"><td>Balance remaining</td><td>${currencySymbol} ${formatAmount(invoice.balance_due || 0)}</td></tr>
      </tbody>
    </table>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Receipt ${escapeHtml(receipt.receipt_number)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; padding: 40px; color: #333; }
    .header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 40px; border-bottom: 3px solid #14b8a6; padding-bottom: 20px; }
    .logo { font-size: 28px; font-weight: bold; color: #0f766e; }
    .receipt-info { text-align: right; }
    .receipt-number { font-size: 24px; font-weight: bold; color: #0f766e; }
    .receipt-date { color: #666; margin-top: 5px; }
    .parties { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 40px; }
    .party { width: 48%; overflow-wrap: anywhere; }
    .party-label { font-size: 12px; text-transform: uppercase; color: #666; margin-bottom: 8px; font-weight: 600; }
    .party-name { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
    .party-details { color: #666; font-size: 14px; line-height: 1.6; }
    .amount-box { background: #0f766e; color: white; padding: 30px; border-radius: 12px; text-align: center; margin-bottom: 40px; }
    .amount-label { font-size: 14px; margin-bottom: 10px; }
    .amount-value { font-size: 42px; font-weight: bold; overflow-wrap: anywhere; }
    .details-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
    .details-table th, .details-table td { padding: 10px; text-align: left; border-bottom: 1px solid #eee; overflow-wrap: anywhere; font-size: 13px; }
    .details-table th { background: #f8f9fa; font-weight: 600; color: #666; font-size: 11px; text-transform: uppercase; }
    .summary-table { width: 100%; max-width: 520px; margin: 0 0 28px auto; border-collapse: collapse; }
    .summary-table td { padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 13px; }
    .summary-table td:last-child { text-align: right; white-space: nowrap; }
    .summary-total { font-weight: 700; border-top: 2px solid #333; }
    .summary-balance { font-weight: 700; color: #0f766e; }
    .signature-section { margin-top: 60px; border-top: 1px solid #eee; padding-top: 30px; }
    .signature-box { width: 250px; max-width: 100%; }
    .signature-image { display: block; max-width: 200px; max-height: 60px; object-fit: contain; margin-bottom: 10px; }
    .signature-line { border-top: 2px solid #333; padding-top: 10px; }
    .signature-name { font-weight: bold; overflow-wrap: anywhere; }
    .signature-title { font-size: 12px; color: #666; }
    .footer { margin-top: 40px; text-align: center; color: #999; font-size: 12px; }
    .status-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: 600; text-transform: uppercase; font-size: 12px; }
    .status-issued { background: #dcfce7; color: #166534; }
    .status-void { background: #fee2e2; color: #991b1b; }
    .checksum { font-family: monospace; font-size: 10px; color: #999; margin-top: 20px; word-break: break-all; }
    @media (max-width: 600px) {
      body { padding: 20px; }
      .header, .parties { flex-direction: column; }
      .receipt-info { text-align: left; }
      .party { width: 100%; }
      .amount-value { font-size: 32px; }
    }
    @media print {
      body { padding: 0; }
      .amount-box { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .status-badge { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <header class="header">
    <div>
      <div class="logo">${escapeHtml(companyName)}</div>
      <div style="color:#666;font-size:14px;margin-top:5px">Payment Receipt</div>
    </div>
    <div class="receipt-info">
      <div class="receipt-number">${escapeHtml(receipt.receipt_number)}</div>
      <div class="receipt-date">${escapeHtml(issueDate)}</div>
      <span class="status-badge status-${status}">${statusLabel}</span>
    </div>
  </header>

  <section class="parties">
    <div class="party">
      <div class="party-label">Received From</div>
      <div class="party-name">${escapeHtml(receipt.customer?.name || "N/A")}</div>
      <div class="party-details">
        ${escapeHtml(receipt.customer?.email)}<br>
        ${escapeHtml(receipt.customer?.phone)}<br>
        ${escapeHtml(receipt.customer?.address_line1)}${receipt.customer?.city ? `, ${escapeHtml(receipt.customer.city)}` : ""}
      </div>
    </div>
    <div class="party" style="text-align:right">
      <div class="party-label">Payment Method</div>
      <div class="party-name" style="text-transform:capitalize">${paymentMethod}</div>
      ${invoiceNumber ? `<div class="party-details">Invoice: ${invoiceNumber}</div>` : ""}
    </div>
  </section>

  <section class="amount-box">
    <div class="amount-label">Amount Received</div>
    <div class="amount-value">${currencySymbol} ${amount}</div>
  </section>

  ${invoice ? `
  <h2 style="font-size:16px;margin:0 0 12px">Invoice items</h2>
  <table class="details-table">
    <thead><tr><th>Description</th><th>Qty</th><th style="text-align:right">Unit price</th><th style="text-align:right">Discount</th><th style="text-align:right">Line total</th></tr></thead>
    <tbody>${invoiceItemsHtml || '<tr><td colspan="5">No item details available</td></tr>'}</tbody>
  </table>
  ${invoice.invoice_taxes?.length ? `
  <h2 style="font-size:16px;margin:24px 0 12px">Tax breakdown</h2>
  <table class="details-table">
    <thead><tr><th>Tax</th><th style="text-align:right">Rate</th><th style="text-align:right">Taxable amount</th><th style="text-align:right">Tax amount</th></tr></thead>
    <tbody>${taxBreakdownHtml}</tbody>
  </table>` : ""}
  ${invoiceSummaryHtml}
  ` : `
  <table class="details-table"><thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody><tr><td>Payment for services</td><td style="text-align:right">${currencySymbol} ${amount}</td></tr></tbody>
  </table>`}
  ${receipt.notes ? `<p style="margin:18px 0;color:#666;font-style:italic">Note: ${escapeHtml(receipt.notes)}</p>` : ""}

  <section class="signature-section">
    <div class="signature-box">
      ${signature ? `<img src="${escapeHtml(signature)}" alt="Signature" class="signature-image">` : '<div style="height:60px"></div>'}
      <div class="signature-line">
        <div class="signature-name">${escapeHtml(receipt.issuer_name)}</div>
        <div class="signature-title">Authorized Signatory</div>
      </div>
    </div>
  </section>

  <footer class="footer">
    <p>This is a computer-generated receipt.</p>
    <p style="margin-top:10px;font-size:15px;color:#0f766e;font-weight:600">Thank you for choosing us. We sincerely appreciate your patronage!</p>
    ${receipt.checksum ? `<div class="checksum">Verification: ${escapeHtml(receipt.checksum)}</div>` : ""}
  </footer>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authorization.slice("Bearer ".length).trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase user-scoped credentials are not configured.");
    }

    // Forward the caller's JWT so the database applies that user's RLS policies.
    // Never use the service-role key for a user-facing receipt lookup.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: ReceiptData;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "A valid JSON request body is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (typeof body.receiptId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.receiptId)) {
      return new Response(JSON.stringify({ error: "A valid receipt ID is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: receipt, error: receiptError } = await supabase
      .from("receipts")
      .select(`
        receipt_number,
        issue_date,
        status,
        payment_method,
        amount,
        issuer_name,
        signature_data,
        checksum,
        notes,
        customer:customers(name, email, phone, address_line1, city),
        invoice:invoices(invoice_number)
      `)
      .eq("id", body.receiptId)
      .is("deleted_at", null)
      .single();

    if (receiptError || !receipt) {
      // RLS intentionally makes inaccessible records indistinguishable from missing records.
      return new Response(JSON.stringify({ error: "Receipt not found or access denied." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings } = await supabase
      .from("company_settings")
      .select("company_name, currency_symbol")
      .limit(1)
      .maybeSingle();
    const html = renderReceipt(
      receipt as unknown as ReceiptRecord,
      settings?.currency_symbol || "$",
      settings?.company_name || "Your Business",
    );
    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Receipt print generation failed:", error);
    return new Response(JSON.stringify({ error: "Failed to generate receipt. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
