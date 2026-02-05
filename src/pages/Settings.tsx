import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useSettings } from '@/hooks/useSettings';
import { LogoUpload } from '@/components/settings/LogoUpload';
import { Building2, FileText, Bell, DollarSign, Loader2, Save, X } from 'lucide-react';

// Currency code to symbol mapping
const currencySymbolMap: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  GHS: 'GH₵',
  NGN: '₦',
  ZAR: 'R',
  KES: 'KSh',
  CAD: 'C$',
  AUD: 'A$',
  JPY: '¥',
  CNY: '¥',
  INR: '₹',
  AED: 'د.إ',
  CHF: 'CHF',
};

const companySchema = z.object({
  company_name: z.string().min(1, 'Company name is required'),
  company_email: z.string().email().optional().or(z.literal('')),
  company_phone: z.string().optional(),
  company_address: z.string().optional(),
  company_city: z.string().optional(),
  company_state: z.string().optional(),
  company_postal_code: z.string().optional(),
  company_country: z.string().optional(),
  company_tax_id: z.string().optional(),
});

const invoiceSchema = z.object({
  invoice_prefix: z.string().optional(),
  receipt_prefix: z.string().optional(),
  payment_prefix: z.string().optional(),
  default_payment_terms: z.string().optional(),
  default_invoice_notes: z.string().optional(),
  default_invoice_terms: z.string().optional(),
  currency_code: z.string().optional(),
  currency_symbol: z.string().optional(),
});

const notificationSchema = z.object({
  notify_on_invoice_issued: z.boolean(),
  notify_on_payment_received: z.boolean(),
  notify_on_overdue: z.boolean(),
});

type CompanyFormData = z.infer<typeof companySchema>;
type InvoiceFormData = z.infer<typeof invoiceSchema>;
type NotificationFormData = z.infer<typeof notificationSchema>;

export default function Settings() {
  const { settings, isLoading, updateSettings, isUpdating } = useSettings();
  const [reminderDays, setReminderDays] = useState<number[]>([7, 14, 30]);
  const [newReminderDay, setNewReminderDay] = useState('');
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);

  const companyForm = useForm<CompanyFormData>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      company_name: '',
      company_email: '',
      company_phone: '',
      company_address: '',
      company_city: '',
      company_state: '',
      company_postal_code: '',
      company_country: '',
      company_tax_id: '',
    },
  });

  const invoiceForm = useForm<InvoiceFormData>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      invoice_prefix: 'INV-',
      receipt_prefix: 'RCP-',
      payment_prefix: 'PAY-',
      default_payment_terms: 'Net 30',
      default_invoice_notes: '',
      default_invoice_terms: '',
      currency_code: 'USD',
      currency_symbol: '$',
    },
  });

  const notificationForm = useForm<NotificationFormData>({
    resolver: zodResolver(notificationSchema),
    defaultValues: {
      notify_on_invoice_issued: true,
      notify_on_payment_received: true,
      notify_on_overdue: true,
    },
  });

  useEffect(() => {
    if (settings) {
      companyForm.reset({
        company_name: settings.company_name || '',
        company_email: settings.company_email || '',
        company_phone: settings.company_phone || '',
        company_address: settings.company_address || '',
        company_city: settings.company_city || '',
        company_state: settings.company_state || '',
        company_postal_code: settings.company_postal_code || '',
        company_country: settings.company_country || '',
        company_tax_id: settings.company_tax_id || '',
      });

      invoiceForm.reset({
        invoice_prefix: settings.invoice_prefix || 'INV-',
        receipt_prefix: settings.receipt_prefix || 'RCP-',
        payment_prefix: settings.payment_prefix || 'PAY-',
        default_payment_terms: settings.default_payment_terms || 'Net 30',
        default_invoice_notes: settings.default_invoice_notes || '',
        default_invoice_terms: settings.default_invoice_terms || '',
        currency_code: settings.currency_code || 'USD',
        currency_symbol: settings.currency_symbol || '$',
      });

      notificationForm.reset({
        notify_on_invoice_issued: settings.notify_on_invoice_issued ?? true,
        notify_on_payment_received: settings.notify_on_payment_received ?? true,
        notify_on_overdue: settings.notify_on_overdue ?? true,
      });

      setReminderDays(settings.overdue_reminder_days || [7, 14, 30]);
      setCompanyLogoUrl(settings.company_logo_url || null);
    }
  }, [settings]);

  const onCompanySubmit = async (data: CompanyFormData) => {
    await updateSettings({
      ...data,
      company_logo_url: companyLogoUrl,
    });
  };

  const onInvoiceSubmit = async (data: InvoiceFormData) => {
    await updateSettings(data);
  };

  const onNotificationSubmit = async (data: NotificationFormData) => {
    await updateSettings({
      ...data,
      overdue_reminder_days: reminderDays,
    });
  };

  const addReminderDay = () => {
    const day = parseInt(newReminderDay);
    if (day > 0 && !reminderDays.includes(day)) {
      setReminderDays([...reminderDays, day].sort((a, b) => a - b));
      setNewReminderDay('');
    }
  };

  const removeReminderDay = (day: number) => {
    setReminderDays(reminderDays.filter(d => d !== day));
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Configure your company details, invoice defaults, and notification preferences.
          </p>
        </div>

        <Tabs defaultValue="company" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
            <TabsTrigger value="company" className="gap-2">
              <Building2 className="h-4 w-4" />
              Company
            </TabsTrigger>
            <TabsTrigger value="invoices" className="gap-2">
              <FileText className="h-4 w-4" />
              Invoices
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2">
              <Bell className="h-4 w-4" />
              Notifications
            </TabsTrigger>
          </TabsList>

          <TabsContent value="company">
            <Card>
              <CardHeader>
                <CardTitle>Company Details</CardTitle>
                <CardDescription>
                  This information will appear on your invoices and receipts.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...companyForm}>
                  <form onSubmit={companyForm.handleSubmit(onCompanySubmit)} className="space-y-6">
                    {/* Logo Upload */}
                    <LogoUpload
                      currentLogoUrl={companyLogoUrl}
                      onLogoChange={setCompanyLogoUrl}
                      isUpdating={isUpdating}
                    />

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={companyForm.control}
                        name="company_name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Company Name *</FormLabel>
                            <FormControl>
                              <Input placeholder="Acme Inc." {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={companyForm.control}
                        name="company_email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="contact@company.com" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={companyForm.control}
                        name="company_phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                              <Input placeholder="+1 (555) 000-0000" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={companyForm.control}
                        name="company_tax_id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tax ID / VAT Number</FormLabel>
                            <FormControl>
                              <Input placeholder="XX-XXXXXXX" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={companyForm.control}
                      name="company_address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Street Address</FormLabel>
                          <FormControl>
                            <Input placeholder="123 Business Ave, Suite 100" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-4 md:grid-cols-4">
                      <FormField
                        control={companyForm.control}
                        name="company_city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input placeholder="New York" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={companyForm.control}
                        name="company_state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State/Province</FormLabel>
                            <FormControl>
                              <Input placeholder="NY" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={companyForm.control}
                        name="company_postal_code"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Postal Code</FormLabel>
                            <FormControl>
                              <Input placeholder="10001" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={companyForm.control}
                        name="company_country"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Country</FormLabel>
                            <FormControl>
                              <Input placeholder="United States" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <Button type="submit" disabled={isUpdating}>
                      {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Save Company Details
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invoices">
            <Card>
              <CardHeader>
                <CardTitle>Invoice & Receipt Defaults</CardTitle>
                <CardDescription>
                  Configure default settings for new invoices and receipts.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...invoiceForm}>
                  <form onSubmit={invoiceForm.handleSubmit(onInvoiceSubmit)} className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-3">
                      <FormField
                        control={invoiceForm.control}
                        name="invoice_prefix"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Invoice Prefix</FormLabel>
                            <FormControl>
                              <Input placeholder="INV-" {...field} />
                            </FormControl>
                            <FormDescription>e.g., INV-0001</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={invoiceForm.control}
                        name="receipt_prefix"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Receipt Prefix</FormLabel>
                            <FormControl>
                              <Input placeholder="RCP-" {...field} />
                            </FormControl>
                            <FormDescription>e.g., RCP-0001</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={invoiceForm.control}
                        name="payment_prefix"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Payment Prefix</FormLabel>
                            <FormControl>
                              <Input placeholder="PAY-" {...field} />
                            </FormControl>
                            <FormDescription>e.g., PAY-0001</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <FormField
                        control={invoiceForm.control}
                        name="currency_code"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Currency Code</FormLabel>
                            <Select 
                              onValueChange={(value) => {
                                field.onChange(value);
                                // Auto-update currency symbol when currency code changes
                                const symbol = currencySymbolMap[value] || '$';
                                invoiceForm.setValue('currency_symbol', symbol);
                              }} 
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select currency" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="USD">USD - US Dollar</SelectItem>
                                <SelectItem value="EUR">EUR - Euro</SelectItem>
                                <SelectItem value="GBP">GBP - British Pound</SelectItem>
                                <SelectItem value="GHS">GHS - Ghana Cedi</SelectItem>
                                <SelectItem value="NGN">NGN - Nigerian Naira</SelectItem>
                                <SelectItem value="ZAR">ZAR - South African Rand</SelectItem>
                                <SelectItem value="KES">KES - Kenyan Shilling</SelectItem>
                                <SelectItem value="CAD">CAD - Canadian Dollar</SelectItem>
                                <SelectItem value="AUD">AUD - Australian Dollar</SelectItem>
                                <SelectItem value="JPY">JPY - Japanese Yen</SelectItem>
                                <SelectItem value="CNY">CNY - Chinese Yuan</SelectItem>
                                <SelectItem value="INR">INR - Indian Rupee</SelectItem>
                                <SelectItem value="AED">AED - UAE Dirham</SelectItem>
                                <SelectItem value="CHF">CHF - Swiss Franc</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={invoiceForm.control}
                        name="currency_symbol"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Currency Symbol</FormLabel>
                            <FormControl>
                              <Input placeholder="$" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={invoiceForm.control}
                        name="default_payment_terms"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Default Payment Terms</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select terms" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="Due on Receipt">Due on Receipt</SelectItem>
                                <SelectItem value="Net 7">Net 7</SelectItem>
                                <SelectItem value="Net 15">Net 15</SelectItem>
                                <SelectItem value="Net 30">Net 30</SelectItem>
                                <SelectItem value="Net 45">Net 45</SelectItem>
                                <SelectItem value="Net 60">Net 60</SelectItem>
                                <SelectItem value="Net 90">Net 90</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={invoiceForm.control}
                      name="default_invoice_notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Default Invoice Notes</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Thank you for your business!"
                              className="min-h-[80px]"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            This will be pre-filled in the notes section of new invoices.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={invoiceForm.control}
                      name="default_invoice_terms"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Default Invoice Terms & Conditions</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Payment is due within the specified terms..."
                              className="min-h-[100px]"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            This will be pre-filled in the terms section of new invoices.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button type="submit" disabled={isUpdating}>
                      {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Save Invoice Defaults
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Email Notifications</CardTitle>
                <CardDescription>
                  Configure when and how notifications are sent to customers.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...notificationForm}>
                  <form onSubmit={notificationForm.handleSubmit(onNotificationSubmit)} className="space-y-6">
                    <div className="space-y-4">
                      <FormField
                        control={notificationForm.control}
                        name="notify_on_invoice_issued"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Invoice Issued</FormLabel>
                              <FormDescription>
                                Send email to customers when an invoice is issued.
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={notificationForm.control}
                        name="notify_on_payment_received"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Payment Received</FormLabel>
                              <FormDescription>
                                Send email confirmation when a payment is received.
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={notificationForm.control}
                        name="notify_on_overdue"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Overdue Reminders</FormLabel>
                              <FormDescription>
                                Send reminder emails for overdue invoices.
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="space-y-3">
                      <FormLabel>Overdue Reminder Schedule</FormLabel>
                      <FormDescription>
                        Days after due date to send reminder emails.
                      </FormDescription>
                      <div className="flex flex-wrap gap-2">
                        {reminderDays.map((day) => (
                          <Badge key={day} variant="secondary" className="gap-1">
                            {day} days
                            <button
                              type="button"
                              onClick={() => removeReminderDay(day)}
                              className="ml-1 hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          placeholder="Days"
                          value={newReminderDay}
                          onChange={(e) => setNewReminderDay(e.target.value)}
                          className="w-24"
                          min="1"
                        />
                        <Button type="button" variant="outline" onClick={addReminderDay}>
                          Add
                        </Button>
                      </div>
                    </div>

                    <Button type="submit" disabled={isUpdating}>
                      {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Save Notification Settings
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
