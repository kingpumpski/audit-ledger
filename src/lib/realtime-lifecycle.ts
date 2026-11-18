import { supabase } from '@/integrations/supabase/client';

type RealtimeChannel = ReturnType<typeof supabase.channel>;

/**
 * Close active Realtime channels before a page enters the Back-Forward Cache,
 * then recreate them and refresh their queries when the page is restored.
 */
export function subscribeRealtimeWithPageLifecycle(
  createChannel: () => RealtimeChannel,
  onRestore?: () => void,
): () => void {
  let channel: RealtimeChannel | null = null;

  const subscribe = () => {
    channel = createChannel();
  };

  const unsubscribe = async () => {
    if (!channel) return;
    const activeChannel = channel;
    channel = null;
    await supabase.removeChannel(activeChannel);
  };

  const handlePageHide = (event: PageTransitionEvent) => {
    if (event.persisted) void unsubscribe();
  };

  const handlePageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    void (async () => {
      await unsubscribe();
      subscribe();
      onRestore?.();
    })();
  };

  subscribe();
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);

  return () => {
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('pageshow', handlePageShow);
    void unsubscribe();
  };
}
