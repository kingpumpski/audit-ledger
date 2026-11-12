import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { escapeDeep, escapeHtml, requireRoles } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cronToken = req.headers.get("x-cron-token");
    let cronOk = false;
    if (cronToken) {
      const { data: valid } = await createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
        .rpc("verify_cron_token", { _name: "overdue", _token: cronToken });
      cronOk = valid === true;
    }
    const auth = cronOk ? { ok: true as const } : await requireRoles(req, ["admin", "accountant"], { allowService: true });
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch company settings
    const { data: settings } = await supabase
      .from("company_settings")
      .select("*")
      .limit(1)
      .single();

    // Check if overdue notifications are enabled
    if (!settings?.notify_on_overdue) {
      console.log("Overdue notifications disabled");
      return new Response(
        JSON.stringify({ success: true, message: "Overdue notifications disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!resendApiKey) {
      console.log("RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ success: true, message: "Email provider not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const reminderDays = settings.overdue_reminder_days || [7, 14, 30];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch all overdue invoices (due_date < today, status not paid/canceled)
    const { data: overdueInvoices, error: invoicesError } = await supabase
      .from("invoices")
      .select(`
        *,
        customer:customers(*)
      `)
      .lt("due_date", today.toISOString())
      .in("status", ["issued", "overdue", "partially_paid"])
      .is("deleted_at", null);

    if (invoicesError) {
      console.error("Error fetching overdue invoices:", invoicesError);
      throw invoicesError;
    }

    if (!overdueInvoices || overdueInvoices.length === 0) {
      console.log("No overdue invoices found");
      return new Response(
        JSON.stringify({ success: true, message: "No overdue invoices found", count: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const companyName = settings.company_name || "InvoiceHub";
    const currencySymbol = settings.currency_symbol || "$";
    let emailsSent = 0;
    const errors: string[] = [];

    for (const invoice of overdueInvoices) {
      // Calculate days overdue
      const dueDate = new Date(invoice.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      // Check if we should send reminder for this day
      if (!reminderDays.includes(daysOverdue)) {
        continue;
      }

      // Skip if customer has no email
      if (!invoice.customer?.email) {
        continue;
      }

      // Update invoice status to overdue if not already
      if (invoice.status !== "overdue" && invoice.status !== "partially_paid") {
        await supabase
          .from("invoices")
          .update({ status: "overdue" })
          .eq("id", invoice.id);
      }

      const balanceDue = invoice.balance_due || invoice.total_amount || 0;

      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Payment Reminder</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 650px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
          <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">⚠️ Payment Overdue</h1>
          </div>
          
          <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <p style="font-size: 16px;">Dear ${escapeHtml(invoice.customer.name)},</p>
            
            <p>This is a friendly reminder that your invoice is now <strong style="color: #ef4444;">${daysOverdue} days overdue</strong>.</p>
            
            <div style="background: #fef2f2; border: 2px solid #fecaca; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <table style="width: 100%;">
                <tr>
                  <td><strong>Invoice Number:</strong></td>
                  <td style="text-align: right;">${escapeHtml(invoice.invoice_number)}</td>
                </tr>
                <tr>
                  <td><strong>Original Due Date:</strong></td>
                  <td style="text-align: right;">${new Date(invoice.due_date).toLocaleDateString()}</td>
                </tr>
                <tr>
                  <td><strong>Days Overdue:</strong></td>
                  <td style="text-align: right; color: #ef4444; font-weight: bold;">${daysOverdue} days</td>
                </tr>
                <tr style="font-size: 18px;">
                  <td><strong>Amount Due:</strong></td>
                  <td style="text-align: right; color: #ef4444; font-weight: bold;">${currencySymbol}${balanceDue.toFixed(2)}</td>
                </tr>
              </table>
            </div>
            
            <p>Please arrange payment at your earliest convenience to avoid any further action.</p>
            
            <p>If you have already made this payment, please disregard this notice. If you have any questions or need to discuss payment arrangements, please contact us.</p>
            
            <p style="margin-top: 30px;">Best regards,<br><strong>${escapeHtml(companyName)}</strong></p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px;">
            <p>This is an automated payment reminder from ${escapeHtml(companyName)}.</p>
            <p>&copy; ${new Date().getFullYear()} ${escapeHtml(companyName)}. All rights reserved.</p>
          </div>
        </body>
        </html>
      `;

      try {
        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${String(companyName).replace(/[<>"\r\n]/g, "")} <notifications@resend.dev>`,
            to: [invoice.customer.email],
            subject: `Payment Reminder: Invoice ${invoice.invoice_number} is ${daysOverdue} days overdue`,
            html: emailHtml,
          }),
        });

        if (emailResponse.ok) {
          emailsSent++;
          console.log(`Sent overdue reminder for invoice ${invoice.invoice_number}`);
          
          // Create in-app notification
          const { data: adminUsers } = await supabase
            .from("user_roles")
            .select("user_id")
            .in("role", ["admin", "accountant"]);

          if (adminUsers) {
            for (const admin of adminUsers) {
              await supabase.from("notifications").insert({
                user_id: admin.user_id,
                title: "Overdue Reminder Sent",
                message: `Overdue reminder sent for invoice ${invoice.invoice_number} (${daysOverdue} days overdue)`,
                type: "overdue",
                link: `/invoices?id=${invoice.id}`,
              });
            }
          }
        } else {
          const errorData = await emailResponse.json();
          errors.push(`Invoice ${invoice.invoice_number}: ${JSON.stringify(errorData)}`);
        }
      } catch (emailError) {
        errors.push(`Invoice ${invoice.invoice_number}: ${emailError}`);
      }
    }

    console.log(`Overdue check complete. Emails sent: ${emailsSent}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        emailsSent, 
        totalOverdue: overdueInvoices.length,
        errors: errors.length > 0 ? errors : undefined
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error checking overdue invoices:", error);
    return new Response(
      JSON.stringify({ error: "Failed to check overdue invoices" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
