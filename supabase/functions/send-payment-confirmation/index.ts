import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PaymentConfirmationRequest {
  paymentId: string;
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

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.log("RESEND_API_KEY not configured, skipping email");
      return new Response(
        JSON.stringify({ success: true, message: "Email provider not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { paymentId }: PaymentConfirmationRequest = await req.json();

    if (!paymentId) {
      throw new Error("Payment ID is required");
    }

    // Fetch payment with related data
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select(`
        *,
        customer:customers(*),
        invoice:invoices(*)
      `)
      .eq("id", paymentId)
      .single();

    if (paymentError || !payment) {
      throw new Error(`Payment not found: ${paymentError?.message}`);
    }

    // Fetch company settings
    const { data: settings } = await supabase
      .from("company_settings")
      .select("*")
      .single();

    // Check if payment confirmation emails are enabled
    if (settings && !settings.notify_on_payment_received) {
      return new Response(
        JSON.stringify({ success: true, message: "Payment notification disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const companyName = settings?.company_name || "Our Company";
    const companyEmail = settings?.company_email || "noreply@example.com";
    const companyPhone = settings?.company_phone || "";
    const companyAddress = [
      settings?.company_address,
      settings?.company_city,
      settings?.company_state,
      settings?.company_postal_code,
      settings?.company_country
    ].filter(Boolean).join(", ");
    const currencySymbol = settings?.currency_symbol || "$";
    const logoUrl = settings?.company_logo_url || "";

    const customerEmail = payment.customer?.email;
    const customerName = payment.customer?.name || "Valued Customer";

    if (!customerEmail) {
      console.log("No customer email found, skipping payment confirmation");
      return new Response(
        JSON.stringify({ success: false, message: "No customer email" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format payment method
    const paymentMethodLabels: Record<string, string> = {
      cash: "Cash",
      credit_card: "Credit Card",
      debit_card: "Debit Card",
      bank_transfer: "Bank Transfer",
      check: "Check",
      mobile_payment: "Mobile Payment",
      other: "Other"
    };
    const paymentMethodDisplay = paymentMethodLabels[payment.payment_method] || payment.payment_method;

    // Format date
    const paymentDate = new Date(payment.payment_date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });

    // Format amount
    const formattedAmount = `${currencySymbol}${Number(payment.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

    // Get invoice details
    const invoiceNumber = payment.invoice?.invoice_number || "N/A";
    const invoiceTotal = payment.invoice?.total_amount 
      ? `${currencySymbol}${Number(payment.invoice.total_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
      : "N/A";
    const balanceAfterPayment = payment.invoice?.balance_due !== undefined
      ? `${currencySymbol}${Math.max(0, Number(payment.invoice.balance_due) - Number(payment.amount)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
      : "N/A";

    // Build email HTML
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Confirmation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px; text-align: center;">
              ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="max-height: 50px; max-width: 180px; margin-bottom: 16px;">` : ""}
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">Payment Received</h1>
              <p style="color: rgba(255, 255, 255, 0.9); margin: 8px 0 0 0; font-size: 16px;">Thank you for your payment!</p>
            </td>
          </tr>

          <!-- Success Icon -->
          <tr>
            <td style="padding: 32px 32px 16px; text-align: center;">
              <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 50%; line-height: 80px; text-align: center;">
                <span style="font-size: 40px; color: white;">✓</span>
              </div>
            </td>
          </tr>

          <!-- Amount -->
          <tr>
            <td style="padding: 0 32px 24px; text-align: center;">
              <p style="color: #6b7280; margin: 0 0 8px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Amount Paid</p>
              <p style="color: #111827; margin: 0; font-size: 42px; font-weight: 700;">${formattedAmount}</p>
            </td>
          </tr>

          <!-- Payment Details -->
          <tr>
            <td style="padding: 0 32px 32px;">
              <table role="presentation" width="100%" style="background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" width="100%">
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                          <span style="color: #6b7280; font-size: 14px;">Payment Number</span>
                          <span style="color: #111827; font-size: 14px; font-weight: 600; float: right;">${payment.payment_number}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                          <span style="color: #6b7280; font-size: 14px;">Invoice Number</span>
                          <span style="color: #111827; font-size: 14px; font-weight: 600; float: right;">${invoiceNumber}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                          <span style="color: #6b7280; font-size: 14px;">Payment Date</span>
                          <span style="color: #111827; font-size: 14px; font-weight: 600; float: right;">${paymentDate}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                          <span style="color: #6b7280; font-size: 14px;">Payment Method</span>
                          <span style="color: #111827; font-size: 14px; font-weight: 600; float: right;">${paymentMethodDisplay}</span>
                        </td>
                      </tr>
                      ${payment.reference_number ? `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                          <span style="color: #6b7280; font-size: 14px;">Reference</span>
                          <span style="color: #111827; font-size: 14px; font-weight: 600; float: right;">${payment.reference_number}</span>
                        </td>
                      </tr>
                      ` : ""}
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                          <span style="color: #6b7280; font-size: 14px;">Invoice Total</span>
                          <span style="color: #111827; font-size: 14px; font-weight: 600; float: right;">${invoiceTotal}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <span style="color: #6b7280; font-size: 14px;">Remaining Balance</span>
                          <span style="color: ${balanceAfterPayment === `${currencySymbol}0.00` ? '#10b981' : '#111827'}; font-size: 14px; font-weight: 600; float: right;">${balanceAfterPayment}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Thank You Message -->
          <tr>
            <td style="padding: 0 32px 32px; text-align: center;">
              <p style="color: #374151; margin: 0; font-size: 15px; line-height: 1.6;">
                Dear ${customerName},<br><br>
                We have successfully received your payment. This email serves as your official payment confirmation. 
                Please keep this for your records.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 32px; border-top: 1px solid #e5e7eb;">
              <table role="presentation" width="100%">
                <tr>
                  <td style="text-align: center;">
                    <p style="color: #111827; margin: 0 0 4px 0; font-size: 16px; font-weight: 600;">${companyName}</p>
                    ${companyAddress ? `<p style="color: #6b7280; margin: 0 0 4px 0; font-size: 13px;">${companyAddress}</p>` : ""}
                    ${companyPhone ? `<p style="color: #6b7280; margin: 0 0 4px 0; font-size: 13px;">Phone: ${companyPhone}</p>` : ""}
                    <p style="color: #6b7280; margin: 0; font-size: 13px;">Email: ${companyEmail}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Legal Footer -->
          <tr>
            <td style="padding: 20px 32px; text-align: center;">
              <p style="color: #9ca3af; margin: 0; font-size: 11px; line-height: 1.5;">
                This is an automated payment confirmation. Please do not reply to this email.<br>
                For questions about your payment, please contact us at ${companyEmail}.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    // Send email via Resend API
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${companyName} <notifications@resend.dev>`,
        to: [customerEmail],
        subject: `Payment Confirmation - ${payment.payment_number}`,
        html: emailHtml,
      }),
    });

    const emailResult = await emailResponse.json();

    if (!emailResponse.ok) {
      console.error("Failed to send payment confirmation email:", emailResult);
      return new Response(
        JSON.stringify({ success: false, error: emailResult }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Payment confirmation email sent:", emailResult);

    // Create notification for the payment processor
    if (payment.processed_by) {
      await supabase.from("notifications").insert({
        user_id: payment.processed_by,
        title: "Payment Confirmation Sent",
        message: `Payment confirmation email sent to ${customerName} for ${formattedAmount}`,
        type: "payment",
        link: `/invoices`,
      });
    }

    return new Response(
      JSON.stringify({ success: true, emailId: emailResult.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error sending payment confirmation:", error);
    return new Response(
      JSON.stringify({ error: "Failed to send payment confirmation" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
