import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Bell, BellRing, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNotificationFeed } from '@/hooks/useNotificationFeed';
import { cn } from '@/lib/utils';

export function NotificationBell() {
  const navigate = useNavigate();
  const { notifications, unreadCount, isLoading } = useNotificationFeed();
  const recent = notifications.slice(0, 5);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative shrink-0"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          {unreadCount > 0 ? (
            <BellRing className="h-5 w-5 motion-safe:animate-bounce" aria-hidden="true" />
          ) : (
            <Bell className="h-5 w-5" aria-hidden="true" />
          )}
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground shadow-sm">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <span className="sr-only">{unreadCount} unread notifications</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <DropdownMenuLabel className="p-0">Recent activity</DropdownMenuLabel>
          {unreadCount > 0 && <Badge variant="secondary">{unreadCount} new</Badge>}
        </div>
        <DropdownMenuSeparator />
        {isLoading ? (
          <p className="px-3 py-5 text-center text-sm text-muted-foreground">Loading notifications…</p>
        ) : recent.length === 0 ? (
          <p className="px-3 py-5 text-center text-sm text-muted-foreground">You’re all caught up.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {recent.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className={cn('items-start gap-2 whitespace-normal px-3 py-3', !notification.is_read && 'bg-primary/5')}
                onSelect={() => navigate('/notifications', { state: { notificationId: notification.id } })}
              >
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', notification.is_read ? 'bg-transparent' : 'bg-primary')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{notification.title}</span>
                  <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{notification.message}</span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="justify-between px-3 py-2.5 font-medium"
          onSelect={() => navigate('/notifications')}
        >
          Open notification centre <ChevronRight className="h-4 w-4" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
