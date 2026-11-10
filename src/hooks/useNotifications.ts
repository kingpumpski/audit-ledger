import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface NotificationData {
  invoiceNumber?: string;
  receiptNumber?: string;
  amount?: number;
  dueDate?: string;
  date?: string;
  paymentMethod?: string;
  reference?: string;
  daysOverdue?: number;
  link?: string;
}

type NotificationType = 'invoice_issued' | 'receipt_issued' | 'payment_confirmed' | 'overdue_reminder';
type NotificationChannel = 'email' | 'sms' | 'in_app';

export function useNotifications() {
  const { toast } = useToast();

  const sendNotification = async (
    type: NotificationType,
    recipientEmail: string,
    data: NotificationData,
    channels: NotificationChannel[] = ['email', 'in_app'],
    userId?: string,
    recipientPhone?: string
  ) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('send-notification', {
        body: {
          type,
          recipientEmail,
          recipientPhone,
          data,
          channels,
          userId,
        },
      });

      if (response.error) throw response.error;

      return response.data;
    } catch (error: unknown) {
      console.error('Notification error:', error);
      // Don't throw - notifications should not block main operations
      toast({
        title: 'Notification note',
        description: 'Email notifications will be sent when RESEND_API_KEY is configured.',
        variant: 'default',
      });
      return null;
    }
  };

  const sendInvoiceIssuedNotification = async (
    recipientEmail: string,
    invoiceNumber: string,
    amount: number,
    dueDate: string,
    userId?: string
  ) => {
    return sendNotification(
      'invoice_issued',
      recipientEmail,
      { invoiceNumber, amount, dueDate, link: `/invoices` },
      ['email', 'in_app'],
      userId
    );
  };

  const sendReceiptIssuedNotification = async (
    recipientEmail: string,
    receiptNumber: string,
    amount: number,
    paymentMethod: string,
    date: string,
    userId?: string
  ) => {
    return sendNotification(
      'receipt_issued',
      recipientEmail,
      { receiptNumber, amount, paymentMethod, date, link: `/receipts` },
      ['email', 'in_app'],
      userId
    );
  };

  const sendPaymentConfirmedNotification = async (
    recipientEmail: string,
    amount: number,
    reference: string,
    userId?: string
  ) => {
    return sendNotification(
      'payment_confirmed',
      recipientEmail,
      { amount, reference },
      ['email', 'in_app'],
      userId
    );
  };

  const sendOverdueReminderNotification = async (
    recipientEmail: string,
    invoiceNumber: string,
    amount: number,
    dueDate: string,
    daysOverdue: number,
    userId?: string
  ) => {
    return sendNotification(
      'overdue_reminder',
      recipientEmail,
      { invoiceNumber, amount, dueDate, daysOverdue, link: `/invoices` },
      ['email', 'in_app'],
      userId
    );
  };

  return {
    sendNotification,
    sendInvoiceIssuedNotification,
    sendReceiptIssuedNotification,
    sendPaymentConfirmedNotification,
    sendOverdueReminderNotification,
  };
}
