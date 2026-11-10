import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReceiptData {
  receiptId: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { receiptId }: ReceiptData = await req.json();

    // Fetch receipt with related data
    const { data: receipt, error: receiptError } = await supabase
      .from("receipts")
      .select(`
        *,
        customer:customers(*),
        invoice:invoices(*, items:invoice_items(*)),
        issuer:profiles!receipts_issued_by_fkey(full_name, email, signature_data)
      `)
      .eq("id", receiptId)
      .single();

    if (receiptError || !receipt) {
      return new Response(
        JSON.stringify({ error: "Receipt not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate PDF HTML content
    const pdfHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Receipt ${receipt.receipt_number}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #333; }
    .header { display: flex; justify-content: space-between; margin-bottom: 40px; border-bottom: 3px solid #14b8a6; padding-bottom: 20px; }
    .logo { font-size: 28px; font-weight: bold; color: #14b8a6; }
    .receipt-info { text-align: right; }
    .receipt-number { font-size: 24px; font-weight: bold; color: #14b8a6; }
    .receipt-date { color: #666; margin-top: 5px; }
    .parties { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .party { width: 45%; }
    .party-label { font-size: 12px; text-transform: uppercase; color: #666; margin-bottom: 8px; font-weight: 600; }
    .party-name { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
    .party-details { color: #666; font-size: 14px; line-height: 1.6; }
    .amount-box { background: linear-gradient(135deg, #14b8a6 0%, #6366f1 100%); color: white; padding: 30px; border-radius: 12px; text-align: center; margin-bottom: 40px; }
    .amount-label { font-size: 14px; opacity: 0.9; margin-bottom: 10px; }
    .amount-value { font-size: 48px; font-weight: bold; }
    .details-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
    .details-table th, .details-table td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    .details-table th { background: #f8f9fa; font-weight: 600; color: #666; font-size: 12px; text-transform: uppercase; }
    .signature-section { margin-top: 60px; border-top: 1px solid #eee; padding-top: 30px; }
    .signature-box { width: 250px; }
    .signature-image { max-width: 200px; height: 60px; margin-bottom: 10px; }
    .signature-line { border-top: 2px solid #333; padding-top: 10px; }
    .signature-name { font-weight: bold; }
    .signature-title { font-size: 12px; color: #666; }
    .footer { margin-top: 40px; text-align: center; color: #999; font-size: 12px; }
    .status-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: 600; text-transform: uppercase; font-size: 12px; }
    .status-issued { background: #dcfce7; color: #166534; }
    .status-void { background: #fee2e2; color: #991b1b; }
    .checksum { font-family: monospace; font-size: 10px; color: #999; margin-top: 20px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">InvoiceHub</div>
      <div style="color: #666; font-size: 14px; margin-top: 5px;">Payment Receipt</div>
    </div>
    <div class="receipt-info">
      <div class="receipt-number">${receipt.receipt_number}</div>
      <div class="receipt-date">${new Date(receipt.issue_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
      <span class="status-badge status-${receipt.status}">${receipt.status}</span>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="party-label">Received From</div>
      <div class="party-name">${receipt.customer?.name || 'N/A'}</div>
      <div class="party-details">
        ${receipt.customer?.email || ''}<br>
        ${receipt.customer?.phone || ''}<br>
        ${receipt.customer?.address_line1 || ''}
        ${receipt.customer?.city ? `, ${receipt.customer.city}` : ''}
      </div>
    </div>
    <div class="party" style="text-align: right;">
      <div class="party-label">Payment Method</div>
      <div class="party-name" style="text-transform: capitalize;">${receipt.payment_method.replace(/_/g, ' ')}</div>
      ${receipt.invoice ? `<div class="party-details">Invoice: ${receipt.invoice.invoice_number}</div>` : ''}
    </div>
  </div>

  <div class="amount-box">
    <div class="amount-label">Amount Received</div>
    <div class="amount-value">$${Number(receipt.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
  </div>

  <table class="details-table">
    <tr>
      <th>Description</th>
      <th style="text-align: right;">Amount</th>
    </tr>
    <tr>
      <td>Payment for ${receipt.invoice ? `Invoice ${receipt.invoice.invoice_number}` : 'Services'}</td>
      <td style="text-align: right;">$${Number(receipt.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
    </tr>
    ${receipt.notes ? `<tr><td colspan="2" style="color: #666; font-style: italic;">Note: ${receipt.notes}</td></tr>` : ''}
  </table>

  <div class="signature-section">
    <div class="signature-box">
      ${receipt.signature_data ? `<img src="${receipt.signature_data}" alt="Signature" class="signature-image" />` : '<div style="height: 60px;"></div>'}
      <div class="signature-line">
        <div class="signature-name">${receipt.issuer_name}</div>
        <div class="signature-title">Authorized Signatory</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <p>This is a computer-generated receipt. Thank you for your payment.</p>
    ${receipt.checksum ? `<div class="checksum">Verification: ${receipt.checksum}</div>` : ''}
  </div>
</body>
</html>
    `;

    // Return HTML that can be printed/saved as PDF
    return new Response(pdfHtml, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    });

  } catch (error) {
    console.error("PDF generation error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate PDF" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
