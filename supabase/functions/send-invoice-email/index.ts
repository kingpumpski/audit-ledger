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

    // Generate line items HTML
    const itemsHtml = invoice.items
      .map(
        (item: { description: string; quantity: number; unit_price: number; line_total: number }) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${item.description}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${currencySymbol}${item.unit_price.toFixed(2)}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${currencySymbol}${item.line_total.toFixed(2)}</td>
        </tr>
      `
      )
      .join("");

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
          <h1 style="color: white; margin: 0; font-size: 28px;">${companyName}</h1>
        </div>
        
        <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h2 style="color: #14b8a6; margin-top: 0;">Invoice ${invoice.invoice_number}</h2>
          
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <table style="width: 100%;">
              <tr>
                <td style="vertical-align: top;">
                  <strong>Bill To:</strong><br>
                  ${invoice.customer.name}<br>
                  ${invoice.customer.email || ""}<br>
                  ${invoice.customer.phone || ""}
                </td>
                <td style="vertical-align: top; text-align: right;">
                  <strong>Invoice Date:</strong> ${new Date(invoice.issue_date || invoice.created_at).toLocaleDateString()}<br>
                  <strong>Due Date:</strong> ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : "On Receipt"}<br>
                  <strong>Status:</strong> <span style="color: #f59e0b; font-weight: bold;">${invoice.status.toUpperCase()}</span>
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
          
          ${invoice.notes ? `
          <div style="margin-top: 30px; padding: 15px; background: #fef3c7; border-radius: 8px;">
            <strong>Notes:</strong><br>
            ${invoice.notes}
          </div>
          ` : ""}
          
          ${invoice.terms ? `
          <div style="margin-top: 20px; padding: 15px; background: #f1f5f9; border-radius: 8px; font-size: 14px;">
            <strong>Terms & Conditions:</strong><br>
            ${invoice.terms}
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

    // Send email via Resend
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${companyName} <notifications@resend.dev>`,
        to: [invoice.customer.email],
        subject: `Invoice ${invoice.invoice_number} from ${companyName}`,
        html: emailHtml,
      }),
    });

    const emailResult = await emailResponse.json();

    if (!emailResponse.ok) {
      console.error("Failed to send email:", emailResult);
      return new Response(
        JSON.stringify({ success: false, error: emailResult }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Invoice email sent successfully:", emailResult);

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
