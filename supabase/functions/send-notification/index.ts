import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRequest {
  type: "invoice_issued" | "receipt_issued" | "payment_confirmed" | "overdue_reminder";
  recipientEmail: string;
  recipientPhone?: string;
  data: Record<string, unknown>;
  channels: ("email" | "sms" | "in_app")[];
  userId?: string;
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

    const { type, recipientEmail, recipientPhone, data, channels, userId }: NotificationRequest = await req.json();

    const results: Record<string, unknown> = {};

    // Generate notification content based on type
    const templates: Record<string, { title: string; message: string; emailHtml: string }> = {
      invoice_issued: {
        title: "New Invoice",
        message: `Invoice ${data.invoiceNumber} for $${data.amount} has been issued.`,
        emailHtml: `
          <h2>Invoice Issued</h2>
          <p>A new invoice has been generated for you.</p>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Invoice Number:</strong> ${data.invoiceNumber}</p>
            <p><strong>Amount:</strong> $${data.amount}</p>
            <p><strong>Due Date:</strong> ${data.dueDate}</p>
          </div>
          <p>Please review and process payment at your earliest convenience.</p>
        `,
      },
      receipt_issued: {
        title: "Payment Receipt",
        message: `Receipt ${data.receiptNumber} for $${data.amount} has been issued.`,
        emailHtml: `
          <h2>Payment Receipt</h2>
          <p>Thank you for your payment. Here is your receipt.</p>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Receipt Number:</strong> ${data.receiptNumber}</p>
            <p><strong>Amount Paid:</strong> $${data.amount}</p>
            <p><strong>Payment Method:</strong> ${data.paymentMethod}</p>
            <p><strong>Date:</strong> ${data.date}</p>
          </div>
          <p>This receipt confirms your payment has been successfully processed.</p>
        `,
      },
      payment_confirmed: {
        title: "Payment Confirmed",
        message: `Payment of $${data.amount} has been received. Thank you!`,
        emailHtml: `
          <h2>Payment Confirmed</h2>
          <p>We have received your payment. Thank you!</p>
          <div style="background: #dcfce7; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Amount:</strong> $${data.amount}</p>
            <p><strong>Reference:</strong> ${data.reference}</p>
          </div>
        `,
      },
      overdue_reminder: {
        title: "Payment Overdue",
        message: `Invoice ${data.invoiceNumber} is overdue. Please make payment soon.`,
        emailHtml: `
          <h2 style="color: #dc2626;">Payment Overdue</h2>
          <p>This is a friendly reminder that your invoice is now overdue.</p>
          <div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Invoice Number:</strong> ${data.invoiceNumber}</p>
            <p><strong>Amount Due:</strong> $${data.amount}</p>
            <p><strong>Due Date:</strong> ${data.dueDate}</p>
            <p><strong>Days Overdue:</strong> ${data.daysOverdue}</p>
          </div>
          <p>Please process payment as soon as possible to avoid any late fees.</p>
        `,
      },
    };

    const template = templates[type];
    if (!template) {
      return new Response(
        JSON.stringify({ error: "Invalid notification type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send email if requested and Resend is configured
    if (channels.includes("email") && resendApiKey) {
      try {
        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "InvoiceHub <notifications@resend.dev>",
            to: [recipientEmail],
            subject: template.title,
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <style>
                  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
                  .header { background: linear-gradient(135deg, #14b8a6 0%, #6366f1 100%); color: white; padding: 30px; text-align: center; }
                  .content { padding: 30px; }
                  .footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; }
                </style>
              </head>
              <body>
                <div class="header">
                  <h1>InvoiceHub</h1>
                </div>
                <div class="content">
                  ${template.emailHtml}
                </div>
                <div class="footer">
                  <p>This is an automated notification from InvoiceHub.</p>
                  <p>&copy; ${new Date().getFullYear()} InvoiceHub. All rights reserved.</p>
                </div>
              </body>
              </html>
            `,
          }),
        });
        
        results.email = await emailResponse.json();
      } catch (emailError) {
        console.error("Email sending failed:", emailError);
        results.email = { error: "Failed to send email" };
      }
    } else if (channels.includes("email")) {
      results.email = { status: "skipped", reason: "RESEND_API_KEY not configured" };
    }

    // Store in-app notification if requested
    if (channels.includes("in_app") && userId) {
      const { data: notification, error: notifError } = await supabase
        .from("notifications")
        .insert({
          user_id: userId,
          title: template.title,
          message: template.message,
          type: type,
          link: data.link as string || null,
        })
        .select()
        .single();

      results.in_app = notifError ? { error: notifError.message } : notification;
    }

    // SMS via Twilio if configured
    if (channels.includes("sms") && recipientPhone) {
      const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
      const twilioPhoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

      if (twilioAccountSid && twilioAuthToken && twilioPhoneNumber) {
        try {
          const smsBody = template.message;
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
          
          const smsResponse = await fetch(twilioUrl, {
            method: "POST",
            headers: {
              "Authorization": "Basic " + btoa(`${twilioAccountSid}:${twilioAuthToken}`),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: recipientPhone,
              From: twilioPhoneNumber,
              Body: smsBody,
            }),
          });

          const smsResult = await smsResponse.json();
          
          if (smsResponse.ok) {
            results.sms = { success: true, sid: smsResult.sid };
          } else {
            console.error("Twilio SMS error:", smsResult);
            results.sms = { success: false, error: smsResult.message || "SMS failed" };
          }
        } catch (smsError) {
          console.error("SMS sending failed:", smsError);
          results.sms = { success: false, error: "Failed to send SMS" };
        }
      } else {
        results.sms = { status: "skipped", reason: "Twilio credentials not configured" };
      }
    } else if (channels.includes("sms") && !recipientPhone) {
      results.sms = { status: "skipped", reason: "No phone number provided" };
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Notification error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to send notification" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
