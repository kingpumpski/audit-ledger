import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useBusiness } from '@/contexts/BusinessContext';
import { Tables } from '@/integrations/supabase/types';

type CompanySettings = Tables<'company_settings'>;

export interface SettingsData {
  company_name: string;
  company_email?: string;
  company_phone?: string;
  company_address?: string;
  company_city?: string;
  company_state?: string;
  company_postal_code?: string;
  company_country?: string;
  company_tax_id?: string;
  company_logo_url?: string;
  invoice_prefix?: string;
  receipt_prefix?: string;
  payment_prefix?: string;
  default_payment_terms?: string;
  default_invoice_notes?: string;
  default_invoice_terms?: string;
  currency_code?: string;
  currency_symbol?: string;
  notify_on_invoice_issued?: boolean;
  notify_on_payment_received?: boolean;
  notify_on_overdue?: boolean;
  overdue_reminder_days?: number[];
}

export function useSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeBusiness } = useBusiness();
  const businessId = activeBusiness?.id;

  const settingsQuery = useQuery({
    queryKey: ['company-settings', businessId],
    queryFn: async (): Promise<CompanySettings | null> => {
      const { data, error } = await supabase
        .from('company_settings')
        .select('*')
        .eq('business_id', businessId!)
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!businessId,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (settings: Partial<SettingsData>) => {
      if (!businessId) throw new Error('Select an active business before updating company settings.');
      const existingSettings = settingsQuery.data;
      
      if (existingSettings) {
        const { data, error } = await supabase
          .from('company_settings')
          .update(settings)
          .eq('id', existingSettings.id)
          .eq('business_id', businessId)
          .select()
          .single();

        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('company_settings')
          .insert({ ...settings, business_id: businessId } as SettingsData & { business_id: string })
          .select()
          .single();

        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-settings'] });
      toast({ title: 'Settings saved successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to save settings', description: error.message, variant: 'destructive' });
    },
  });

  return {
    settings: settingsQuery.data,
    isLoading: settingsQuery.isLoading,
    error: settingsQuery.error,
    updateSettings: updateSettingsMutation.mutateAsync,
    isUpdating: updateSettingsMutation.isPending,
  };
}
