import { useCallback, useEffect } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { subscribeRealtimeWithPageLifecycle } from '@/lib/realtime-lifecycle';
import type { Tables } from '@/integrations/supabase/types';

export type AppNotification = Tables<'notifications'>;

export function useNotificationFeed() {
  const { user } = useAuth();
  const { activeBusiness, isLoading: businessLoading } = useBusiness();
  const queryClient = useQueryClient();
  const activeBusinessId = activeBusiness?.id;
  const businessResolutionQuery = useQuery({
    queryKey: ['notification-active-business', user?.id],
    enabled: !!user && !businessLoading && !activeBusinessId,
    staleTime: 30_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.rpc('current_business_id');
      if (error) throw error;
      return data ?? null;
    },
  });
  const businessId = activeBusinessId ?? businessResolutionQuery.data ?? undefined;
  const businessResolutionLoading = !activeBusinessId && businessResolutionQuery.isLoading;
  const feedKey = ['notifications', user?.id, businessId] as const;
  const unreadKey = ['notifications-unread-count', user?.id, businessId] as const;

  const notificationsQuery = useInfiniteQuery({
    queryKey: feedKey,
    enabled: !!user && !businessLoading && !businessResolutionLoading,
    staleTime: 15_000,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<AppNotification[]> => {
      if (!user) return [];
      let query = supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + 49);

      query = businessId
        ? query.or(`business_id.eq.${businessId},business_id.is.null`)
        : query.is('business_id', null);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 50 ? allPages.length * 50 : undefined,
  });

  const unreadQuery = useQuery({
    queryKey: unreadKey,
    enabled: !!user && !businessLoading,
    staleTime: 15_000,
    queryFn: async (): Promise<number> => {
      if (!user) return 0;
      let query = supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      query = businessId
        ? query.or(`business_id.eq.${businessId},business_id.is.null`)
        : query.is('business_id', null);

      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['notifications', user?.id, businessId] });
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count', user?.id, businessId] });
  }, [businessId, queryClient, user?.id]);

  useEffect(() => {
    if (!user || businessLoading) return;

    return subscribeRealtimeWithPageLifecycle(
      () => supabase
        .channel(`user-notifications-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          refresh,
        )
        .subscribe(),
      refresh,
    );
  }, [businessLoading, refresh, user]);

  const markRead = useCallback(async (notificationId: string) => {
    if (!user) return;
    let query = supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('user_id', user.id);

    query = businessId
      ? query.or(`business_id.eq.${businessId},business_id.is.null`)
      : query.is('business_id', null);

    const { error } = await query;
    if (error) throw error;
    refresh();
  }, [businessId, refresh, user]);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    let query = supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('is_read', false);

    query = businessId
      ? query.or(`business_id.eq.${businessId},business_id.is.null`)
      : query.is('business_id', null);

    const { error } = await query;
    if (error) throw error;
    refresh();
  }, [refresh, user]);

  return {
    notifications: notificationsQuery.data?.pages.flat() ?? [],
    unreadCount: unreadQuery.data ?? 0,
    isLoading: notificationsQuery.isLoading || unreadQuery.isLoading,
    hasNextPage: notificationsQuery.hasNextPage,
    isFetchingNextPage: notificationsQuery.isFetchingNextPage,
    fetchNextPage: notificationsQuery.fetchNextPage,
    error: notificationsQuery.error ?? unreadQuery.error ?? businessResolutionQuery.error,
    markRead,
    markAllRead,
    refresh,
  };
}
