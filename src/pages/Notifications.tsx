import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Bell, CheckCheck, ExternalLink, Loader2 } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNotificationFeed } from '@/hooks/useNotificationFeed';
import { toast } from 'sonner';
import type { AppNotification } from '@/hooks/useNotificationFeed';

interface NotificationLocationState {
  notificationId?: string;
}

export default function Notifications() {
  const location = useLocation();
  const navigate = useNavigate();
  const { notifications, unreadCount, isLoading, error, markRead, markAllRead, hasNextPage, isFetchingNextPage, fetchNextPage } = useNotificationFeed();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedNotification = useMemo(
    () => notifications.find((item) => item.id === selectedId) ?? null,
    [notifications, selectedId],
  );

  useEffect(() => {
    const notificationId = (location.state as NotificationLocationState | null)?.notificationId;
    if (!notificationId) return;
    setSelectedId(notificationId);
    void markRead(notificationId).catch((readError: unknown) => {
      toast.error(readError instanceof Error ? readError.message : 'Could not update notification status.');
    });
    navigate('/notifications', { replace: true, state: null });
  }, [location.state, markRead, navigate]);

  useEffect(() => {
    if (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load notifications.');
    }
  }, [error]);

  const openNotification = (notification: AppNotification) => {
    setSelectedId(notification.id);
    if (!notification.is_read) {
      void markRead(notification.id).catch((readError: unknown) => {
        toast.error(readError instanceof Error ? readError.message : 'Could not update notification status.');
      });
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllRead();
      toast.success('All notifications in this workspace marked as read.');
    } catch (readError) {
      toast.error(readError instanceof Error ? readError.message : 'Could not update notifications.');
    }
  };

  return (
    <AppLayout
      title="Notification centre"
      subtitle={unreadCount ? `${unreadCount} unread` : 'Activity history'}
      actions={
        <Button variant="outline" onClick={() => void handleMarkAllRead()} disabled={unreadCount === 0}>
          <CheckCheck className="mr-2 h-4 w-4" />
          Mark all read
        </Button>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <Card>
          <CardContent className="divide-y p-0">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading notification history…
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
                <Bell className="h-8 w-8 opacity-50" />
                <p className="font-medium">No notifications yet</p>
                <p className="text-sm">Project and workspace activity will appear here.</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => openNotification(notification)}
                  className={`flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/50 ${selectedId === notification.id ? 'bg-primary/5' : ''} ${!notification.is_read ? 'bg-primary/[0.03]' : ''}`}
                >
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${notification.is_read ? 'bg-muted' : 'bg-primary'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{notification.title}</span>
                      {!notification.is_read && <Badge variant="secondary" className="text-[10px]">New</Badge>}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">{notification.message}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {format(new Date(notification.created_at), 'PPp')}
                    </span>
                  </span>
                </button>
              ))
            )}
            {hasNextPage && (
              <div className="p-4 text-center">
                <Button variant="outline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Load older notifications
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit xl:sticky xl:top-24">
          <CardContent className="p-5">
            {selectedNotification ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant={selectedNotification.is_read ? 'outline' : 'secondary'}>
                    {selectedNotification.is_read ? 'Read' : 'Unread'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(selectedNotification.created_at), 'PPp')}
                  </span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{selectedNotification.title}</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {selectedNotification.message}
                  </p>
                </div>
                {selectedNotification.link && selectedNotification.link.startsWith('/') && (
                  <Button asChild>
                    <Link to={selectedNotification.link}>
                      Open related section <ExternalLink className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Select a notification to read its full details.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
