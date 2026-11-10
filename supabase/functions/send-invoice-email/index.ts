import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvoiceEmailRequest {
  invoiceId: string;
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
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { invoiceId }: InvoiceEmailRequest = await req.json();

    // Fetch invoice with customer details
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select(`
        *,
        customer:customers(*),
        items:invoice_items(*)
      `)
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch company settings
    const { data: settings } = await supabase
      .from("company_settings")
      .select("*")
      .limit(1)
      .single();

    // Check if email notifications are enabled
    if (settings && !settings.notify_on_invoice_issued) {
      return new Response(
        JSON.stringify({ success: true, message: "Email notifications disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if customer has email
    if (!invoice.customer?.email) {
      return new Response(
        JSON.stringify({ success: true, message: "Customer has no email address" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if Resend is configured
    if (!resendApiKey) {
      console.log("RESEND_API_KEY not configured, skipping email");
      return new Response(
        JSON.stringify({ success: true, message: "Email provider not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const companyName = settings?.company_name || "InvoiceHub";
    const currencySymbol = settings?.currency_symbol || "$";
    const companyLogo = settings?.company_logo_url || null;
    
    // Use company email if verified domain exists, otherwise use Resend's test domain
    const fromEmail = settings?.company_email && settings.company_email.includes("@") 
      ? `${companyName} <${settings.company_email}>`
      : `${companyName} <onboarding@resend.dev>`;

    // Generate PDF HTML for attachment
    const itemsHtml = invoice.items
      .map((item: { description: string; quantity: number; unit_price: number; line_total: number }) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${item.description}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${currencySymbol}${item.unit_price.toFixed(2)}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${currencySymbol}${item.line_total.toFixed(2)}</td>
        </tr>
      `)
      .join("");

    // Generate full invoice PDF HTML
    const pdfHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Invoice ${invoice.invoice_number}</title>
  <style>
    @page { margin: 20mm; size: A4; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #333; background: white; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid #14b8a6; }
    .logo-section { display: flex; align-items: center; gap: 15px; }
    .logo-image { max-width: 80px; max-height: 80px; object-fit: contain; }
    .company-name { font-size: 28px; font-weight: bold; color: #14b8a6; }
    .company-details { font-size: 12px; color: #666; margin-top: 5px; line-height: 1.5; }
    .invoice-info { text-align: right; }
    .invoice-title { font-size: 32px; font-weight: bold; color: #333; }
    .invoice-number { font-size: 16px; color: #666; margin-top: 5px; }
    .parties { display: flex; justify-content: space-between; margin-bottom: 30px; }
    .party { width: 48%; }
    .party-label { font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 8px; font-weight: 600; }
    .party-name { font-size: 16px; font-weight: bold; margin-bottom: 5px; }
    .party-details { color: #666; font-size: 13px; line-height: 1.6; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    .items-table th { background: #14b8a6; color: white; padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; }
    .items-table td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
    .totals-section { text-align: right; margin-top: 20px; }
    .total-row { padding: 8px 0; }
    .grand-total { font-size: 20px; font-weight: bold; color: #14b8a6; border-top: 2px solid #14b8a6; padding-top: 15px; margin-top: 10px; }
    .notes-section { margin-top: 40px; padding: 20px; background: #fef3c7; border-radius: 8px; }
    .terms-section { margin-top: 20px; padding: 20px; background: #f1f5f9; border-radius: 8px; font-size: 13px; }
    .footer { margin-top: 40px; text-align: center; color: #999; font-size: 11px; }
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
        </div>
        ` : ''}
      </div>
    </div>
    <div class="invoice-info">
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-number">${invoice.invoice_number}</div>
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
      </div>
    </div>
    <div class="party" style="text-align: right;">
      <div class="party-label">Invoice Details</div>
      <div class="party-details">
        <strong>Date:</strong> ${new Date(invoice.issue_date || invoice.created_at).toLocaleDateString()}<br>
        <strong>Due:</strong> ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : 'On Receipt'}
      </div>
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align: center;">Qty</th>
        <th style="text-align: right;">Price</th>
        <th style="text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <div class="totals-section">
    <div class="total-row"><strong>Subtotal:</strong> ${currencySymbol}${(invoice.subtotal || 0).toFixed(2)}</div>
    ${invoice.discount_amount ? `<div class="total-row" style="color: #16a34a;"><strong>Discount:</strong> -${currencySymbol}${invoice.discount_amount.toFixed(2)}</div>` : ''}
    ${invoice.tax_amount ? `<div class="total-row"><strong>Tax:</strong> ${currencySymbol}${invoice.tax_amount.toFixed(2)}</div>` : ''}
    <div class="total-row grand-total"><strong>Total:</strong> ${currencySymbol}${(invoice.total_amount || 0).toFixed(2)}</div>
  </div>

  ${invoice.notes ? `<div class="notes-section"><strong>Notes:</strong><br>${invoice.notes}</div>` : ''}
  ${invoice.terms ? `<div class="terms-section"><strong>Terms:</strong><br>${invoice.terms}</div>` : ''}

  <div class="footer">
    <p>Thank you for your business!</p>
    <p>&copy; ${new Date().getFullYear()} ${companyName}</p>
  </div>
</body>
</html>
    `;

    // Convert HTML to base64 for attachment
    const encoder = new TextEncoder();
    const pdfBytes = encoder.encode(pdfHtml);
    const pdfBase64 = btoa(String.fromCharCode(...pdfBytes));

    // Email body HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invoice ${invoice.invoice_number}</title>
      </head>
      <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 650px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
        <div style="background: linear-gradient(135deg, #14b8a6 0%, #6366f1 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
          ${companyLogo ? `<img src="${companyLogo}" alt="${companyName}" style="max-width: 60px; max-height: 60px; margin-bottom: 10px;" />` : ''}
          <h1 style="color: white; margin: 0; font-size: 28px;">${companyName}</h1>
        </div>
        
        <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h2 style="color: #14b8a6; margin-top: 0;">Invoice ${invoice.invoice_number}</h2>
          
          <p style="font-size: 16px;">Dear ${invoice.customer.name},</p>
          
          <p>Please find attached your invoice from ${companyName}. Here's a summary:</p>
          
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <table style="width: 100%;">
              <tr>
                <td style="vertical-align: top;">
                  <strong>Invoice Number:</strong> ${invoice.invoice_number}<br>
                  <strong>Issue Date:</strong> ${new Date(invoice.issue_date || invoice.created_at).toLocaleDateString()}<br>
                  <strong>Due Date:</strong> ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : "On Receipt"}
                </td>
                <td style="vertical-align: top; text-align: right;">
                  <span style="font-size: 24px; font-weight: bold; color: #14b8a6;">${currencySymbol}${(invoice.total_amount || 0).toFixed(2)}</span><br>
                  <span style="color: #666;">Total Amount</span>
                </td>
              </tr>
            </table>
          </div>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background: #f1f5f9;">
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e5e7eb;">Description</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb;">Qty</th>
                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #e5e7eb;">Price</th>
                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #e5e7eb;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          
          <div style="text-align: right; margin-top: 20px;">
            <table style="margin-left: auto;">
              <tr>
                <td style="padding: 8px 20px;"><strong>Subtotal:</strong></td>
                <td style="padding: 8px 0; text-align: right;">${currencySymbol}${(invoice.subtotal || 0).toFixed(2)}</td>
              </tr>
              ${invoice.discount_amount ? `
              <tr>
                <td style="padding: 8px 20px; color: #16a34a;"><strong>Discount:</strong></td>
                <td style="padding: 8px 0; text-align: right; color: #16a34a;">-${currencySymbol}${invoice.discount_amount.toFixed(2)}</td>
              </tr>
              ` : ""}
              ${invoice.tax_amount ? `
              <tr>
                <td style="padding: 8px 20px;"><strong>Tax:</strong></td>
                <td style="padding: 8px 0; text-align: right;">${currencySymbol}${invoice.tax_amount.toFixed(2)}</td>
              </tr>
              ` : ""}
              <tr style="font-size: 18px;">
                <td style="padding: 12px 20px; border-top: 2px solid #e5e7eb;"><strong>Total:</strong></td>
                <td style="padding: 12px 0; text-align: right; border-top: 2px solid #e5e7eb; color: #14b8a6;"><strong>${currencySymbol}${(invoice.total_amount || 0).toFixed(2)}</strong></td>
              </tr>
            </table>
          </div>
          
          <div style="margin-top: 30px; padding: 20px; background: #dcfce7; border-radius: 8px; text-align: center;">
            <p style="margin: 0; color: #166534;"><strong>📎 Invoice PDF attached</strong></p>
            <p style="margin: 5px 0 0 0; font-size: 14px; color: #15803d;">Please open the attachment to view and print your full invoice.</p>
          </div>
          
          ${invoice.notes ? `
          <div style="margin-top: 20px; padding: 15px; background: #fef3c7; border-radius: 8px;">
            <strong>Notes:</strong><br>
            ${invoice.notes}
          </div>
          ` : ""}
        </div>
        
        <div style="text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px;">
          <p>This invoice was generated by ${companyName}.</p>
          <p>&copy; ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;

    // Send email via Resend with PDF attachment
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [invoice.customer.email],
        subject: `Invoice ${invoice.invoice_number} from ${companyName}`,
        html: emailHtml,
        attachments: [
          {
            filename: `Invoice-${invoice.invoice_number}.html`,
            content: pdfBase64,
          }
        ],
      }),
    });

    const emailResult = await emailResponse.json();

    if (!emailResponse.ok) {
      console.error("Failed to send email:", emailResult);
      
      // Handle Resend's domain verification requirement gracefully
      if (emailResult.statusCode === 403 && emailResult.name === "validation_error") {
        console.log("Resend domain not verified - email sending limited to test addresses");
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Email sending requires domain verification. Invoice was issued successfully but email was not sent. Visit resend.com/domains to verify your domain.",
            requiresDomainVerification: true
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: false, error: emailResult }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Invoice email sent successfully with PDF attachment:", emailResult);

    return new Response(
      JSON.stringify({ success: true, emailId: emailResult.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error sending invoice email:", error);
    return new Response(
      JSON.stringify({ error: "Failed to send invoice email" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
