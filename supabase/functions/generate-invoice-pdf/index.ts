import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { escapeDeep, escapeHtml, requireRoles } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept, x-supabase-api-version",
  "Access-Control-Max-Age": "86400",
};

interface InvoicePdfRequest {
  invoiceId: string;
  returnHtml?: boolean;
}

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    // Company logos may be hosted remotely, but active-content and non-web schemes
    // must never be embedded in the generated invoice document.
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return escapeHtml(parsed.toString());
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // Avoid spreading a large invoice HTML byte array into one function call.
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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
    const auth = await requireRoles(req, ["admin", "accountant", "cashier", "auditor"]);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let requestBody: InvoicePdfRequest;
    try {
      requestBody = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "A valid JSON request body is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const invoiceId = requestBody?.invoiceId;
    const returnHtml = requestBody?.returnHtml ?? false;
    if (
      typeof invoiceId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId) ||
      typeof returnHtml !== "boolean"
    ) {
      return new Response(JSON.stringify({ error: "A valid invoice ID and optional boolean returnHtml value are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch invoice with all related data
    const { data: rawInvoice, error: invoiceError } = await supabase
      .from("invoices")
      .select(`
        *,
        customer:customers(*),
        items:invoice_items(*),
        discount:discounts(*),
        invoice_taxes:invoice_taxes(tax_rate, taxable_amount, tax_amount, tax:taxes(name, code))
      `)
      .eq("id", invoiceId)
      .is("deleted_at", null)
      .single();

    if (invoiceError || !rawInvoice) {
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch company settings
    const { data: rawSettings } = await supabase
      .from("company_settings")
      .select("*")
      .limit(1)
      .single();

    const invoice = escapeDeep(rawInvoice);
    const settings = escapeDeep(rawSettings);
    const companyName = settings?.company_name || "InvoiceHub";
    const currencySymbol = settings?.currency_symbol || "$";
    const companyLogo = safeImageUrl(rawSettings?.company_logo_url);

    // Generate line items HTML
    const itemsHtml = invoice.items
      .sort((a: { sort_order: number | null }, b: { sort_order: number | null }) => 
        (a.sort_order || 0) - (b.sort_order || 0))
      .map((item: { description: string; quantity: number; unit_price: number; line_total: number; tax_rate?: number | null }) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${item.description}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${currencySymbol}${item.unit_price.toFixed(2)}</td>
          ${item.tax_rate ? `<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.tax_rate}%</td>` : ''}
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${currencySymbol}${item.line_total.toFixed(2)}</td>
        </tr>
      `)
      .join("");

    const taxBreakdownHtml = (invoice.invoice_taxes ?? []).map((tax: {
      tax_rate: number;
      taxable_amount: number;
      tax_amount: number;
      tax?: { name?: string | null; code?: string | null } | null;
    }) => `
      <tr>
        <td>${tax.tax?.name || tax.tax?.code || "Tax"}</td>
        <td style="text-align: right;">${Number(tax.tax_rate || 0).toFixed(2)}%</td>
        <td style="text-align: right;">${currencySymbol}${Number(tax.taxable_amount || 0).toFixed(2)}</td>
        <td style="text-align: right;">${currencySymbol}${Number(tax.tax_amount || 0).toFixed(2)}</td>
      </tr>
    `).join("");

    const statusColors: Record<string, { bg: string; text: string }> = {
      draft: { bg: "#f1f5f9", text: "#475569" },
      issued: { bg: "#fef3c7", text: "#92400e" },
      paid: { bg: "#dcfce7", text: "#166534" },
      overdue: { bg: "#fee2e2", text: "#991b1b" },
      canceled: { bg: "#f1f5f9", text: "#6b7280" },
      partially_paid: { bg: "#dbeafe", text: "#1e40af" },
    };

    const status = statusColors[invoice.status] || statusColors.draft;

    const pdfHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <title>Invoice ${invoice.invoice_number}</title>
  <style>
    @page { margin: 0; size: A4; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #333; background: white; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid #14b8a6; }
    .logo-section { display: flex; align-items: center; gap: 15px; }
    .logo-image { max-width: 80px; max-height: 80px; object-fit: contain; }
    .company-name { font-size: 28px; font-weight: bold; color: #14b8a6; }
    .company-details { font-size: 12px; color: #666; margin-top: 5px; line-height: 1.5; }
    .invoice-info { text-align: right; }
    .invoice-title { font-size: 32px; font-weight: bold; color: #333; letter-spacing: 2px; }
    .invoice-number { font-size: 16px; color: #666; margin-top: 5px; }
    .status-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: 600; text-transform: uppercase; font-size: 11px; margin-top: 10px; }
    .parties { display: flex; justify-content: space-between; margin-bottom: 30px; }
    .party { width: 48%; }
    .party-label { font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 8px; font-weight: 600; letter-spacing: 1px; }
    .party-name { font-size: 16px; font-weight: bold; margin-bottom: 5px; color: #333; }
    .party-details { color: #666; font-size: 13px; line-height: 1.6; }
    .dates-box { background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 30px; display: flex; justify-content: space-between; }
    .date-item { text-align: center; }
    .date-label { font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 5px; }
    .date-value { font-size: 14px; font-weight: 600; color: #333; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    .items-table th { background: #14b8a6; color: white; padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .items-table th:first-child { border-radius: 8px 0 0 0; }
    .items-table th:last-child { border-radius: 0 8px 0 0; }
    .items-table td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
    .tax-breakdown { margin: 24px 0 30px; }
    .tax-breakdown h3 { font-size: 14px; margin-bottom: 10px; color: #475569; }
    .tax-breakdown table { width: 100%; border-collapse: collapse; }
    .tax-breakdown th, .tax-breakdown td { padding: 9px 12px; border-bottom: 1px solid #e5e7eb; font-size: 12px; text-align: left; }
    .tax-breakdown th { background: #f8fafc; color: #64748b; text-transform: uppercase; font-size: 10px; }
    .tax-breakdown th:not(:first-child), .tax-breakdown td:not(:first-child) { text-align: right; }
    .totals-section { display: flex; justify-content: flex-end; }
    .totals-box { width: 300px; }
    .total-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
    .total-row.grand-total { border-top: 2px solid #14b8a6; border-bottom: none; padding-top: 15px; margin-top: 10px; font-size: 18px; font-weight: bold; }
    .total-row.grand-total .total-value { color: #14b8a6; }
    .notes-section { margin-top: 40px; padding: 20px; background: #fef3c7; border-radius: 8px; }
    .notes-label { font-weight: 600; margin-bottom: 8px; color: #92400e; }
    .terms-section { margin-top: 20px; padding: 20px; background: #f1f5f9; border-radius: 8px; font-size: 13px; }
    .terms-label { font-weight: 600; margin-bottom: 8px; color: #475569; }
    .footer { margin-top: 40px; text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 11px; }
    .checksum { font-family: monospace; font-size: 9px; color: #ccc; margin-top: 10px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-section">
      ${companyLogo ? `<img src="${companyLogo}" alt="${companyName}" class="logo-image" />` : ''}
      <div>
        <div class="company-name">${companyName}</div>
        ${settings ? `
        <div class="company-details">
          ${settings.company_address || ''}<br>
          ${settings.company_city ? `${settings.company_city}, ` : ''}${settings.company_state || ''} ${settings.company_postal_code || ''}<br>
          ${settings.company_email || ''} | ${settings.company_phone || ''}
          ${settings.company_tax_id ? `<br>Tax ID: ${settings.company_tax_id}` : ''}
        </div>
        ` : ''}
      </div>
    </div>
    <div class="invoice-info">
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-number">${invoice.invoice_number}</div>
      <span class="status-badge" style="background: ${status.bg}; color: ${status.text};">${invoice.status.replace('_', ' ')}</span>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="party-label">Bill To</div>
      <div class="party-name">${invoice.customer?.name || 'N/A'}</div>
      <div class="party-details">
        ${invoice.customer?.email || ''}<br>
        ${invoice.customer?.phone || ''}<br>
        ${invoice.customer?.address_line1 || ''}
        ${invoice.customer?.city ? `<br>${invoice.customer.city}` : ''}${invoice.customer?.state ? `, ${invoice.customer.state}` : ''} ${invoice.customer?.postal_code || ''}
        ${invoice.customer?.tax_id ? `<br>Tax ID: ${invoice.customer.tax_id}` : ''}
      </div>
    </div>
    <div class="party" style="text-align: right;">
      <div class="party-label">Invoice Details</div>
      <div class="party-details">
        <strong>Invoice Date:</strong> ${invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString() : new Date(invoice.created_at).toLocaleDateString()}<br>
        <strong>Due Date:</strong> ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : 'On Receipt'}<br>
        ${invoice.terms ? `<strong>Payment Terms:</strong> ${invoice.terms}` : ''}
      </div>
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th style="width: 45%;">Description</th>
        <th style="width: 12%; text-align: center;">Qty</th>
        <th style="width: 18%; text-align: right;">Unit Price</th>
        <th style="width: 15%; text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  ${invoice.invoice_taxes?.length ? `
  <section class="tax-breakdown">
    <h3>Tax breakdown</h3>
    <table>
      <thead><tr><th>Tax</th><th>Rate</th><th>Taxable amount</th><th>Tax amount</th></tr></thead>
      <tbody>${taxBreakdownHtml}</tbody>
    </table>
  </section>
  ` : ""}

  <div class="totals-section">
    <div class="totals-box">
      <div class="total-row">
        <span>Subtotal</span>
        <span>${currencySymbol}${(invoice.subtotal || 0).toFixed(2)}</span>
      </div>
      ${invoice.discount_amount && invoice.discount_amount > 0 ? `
      <div class="total-row" style="color: #16a34a;">
        <span>Discount${invoice.discount ? ` (${invoice.discount.name})` : ''}</span>
        <span>-${currencySymbol}${invoice.discount_amount.toFixed(2)}</span>
      </div>
      ` : ''}
      ${invoice.tax_amount && invoice.tax_amount > 0 ? `
      <div class="total-row">
        <span>Tax</span>
        <span>${currencySymbol}${invoice.tax_amount.toFixed(2)}</span>
      </div>
      ` : ''}
      <div class="total-row grand-total">
        <span>Total</span>
        <span class="total-value">${currencySymbol}${(invoice.total_amount || 0).toFixed(2)}</span>
      </div>
      ${invoice.amount_paid && invoice.amount_paid > 0 ? `
      <div class="total-row" style="color: #16a34a;">
        <span>Amount Paid</span>
        <span>-${currencySymbol}${invoice.amount_paid.toFixed(2)}</span>
      </div>
      <div class="total-row" style="font-weight: 600;">
        <span>Balance Due</span>
        <span>${currencySymbol}${(invoice.balance_due || 0).toFixed(2)}</span>
      </div>
      ` : ''}
    </div>
  </div>

  ${invoice.notes ? `
  <div class="notes-section">
    <div class="notes-label">Notes</div>
    <div>${invoice.notes}</div>
  </div>
  ` : ''}

  ${invoice.terms ? `
  <div class="terms-section">
    <div class="terms-label">Terms & Conditions</div>
    <div>${invoice.terms}</div>
  </div>
  ` : ''}

  <div class="footer">
    <p>Thank you for your business!</p>
    <p>&copy; ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
    ${invoice.checksum ? `<div class="checksum">Verification: ${invoice.checksum}</div>` : ''}
  </div>
</body>
</html>
    `;

    if (returnHtml) {
      return new Response(pdfHtml, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    }

    // Return as base64 encoded HTML for email attachment
    const encoder = new TextEncoder();
    const htmlBytes = encoder.encode(pdfHtml);
    const base64Html = bytesToBase64(htmlBytes);

    return new Response(
      JSON.stringify({ 
        success: true, 
        html: pdfHtml,
        base64: base64Html,
        invoiceNumber: invoice.invoice_number
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );

  } catch (error) {
    console.error("Invoice PDF generation error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate invoice PDF" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
