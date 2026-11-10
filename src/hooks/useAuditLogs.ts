import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AuditLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface AuditLogFilters {
  action?: string;
  entityType?: string;
  userId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
}

export function useAuditLogs(filters: AuditLogFilters = {}) {
  return useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: async (): Promise<AuditLog[]> => {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (filters.action && filters.action !== 'all') {
        query = query.eq('action', filters.action as 'create' | 'update' | 'delete' | 'login' | 'logout' | 'view' | 'export' | 'sign');
      }

      if (filters.entityType && filters.entityType !== 'all') {
        query = query.eq('entity_type', filters.entityType);
      }

      if (filters.userId) {
        query = query.eq('user_id', filters.userId);
      }

      if (filters.dateFrom) {
        query = query.gte('created_at', filters.dateFrom.toISOString());
      }

      if (filters.dateTo) {
        const endOfDay = new Date(filters.dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        query = query.lte('created_at', endOfDay.toISOString());
      }

      if (filters.search) {
        query = query.or(`user_email.ilike.%${filters.search}%,entity_id.eq.${filters.search}`);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as AuditLog[];
    },
  });
}

export function useAuditLogStats() {
  return useQuery({
    queryKey: ['audit-log-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('action, entity_type, created_at')
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) throw error;

      // Calculate stats
      const actionCounts: Record<string, number> = {};
      const entityCounts: Record<string, number> = {};
      const dailyCounts: Record<string, number> = {};

      data.forEach(log => {
        actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
        entityCounts[log.entity_type] = (entityCounts[log.entity_type] || 0) + 1;
        
        const day = new Date(log.created_at).toISOString().split('T')[0];
        dailyCounts[day] = (dailyCounts[day] || 0) + 1;
      });

      return { actionCounts, entityCounts, dailyCounts, total: data.length };
    },
  });
}
