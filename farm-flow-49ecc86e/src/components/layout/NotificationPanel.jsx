
import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bell, X, Clock, MoreVertical, Megaphone } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ALERT_SEGMENT_ORDER, segmentMeta, segmentForType } from './alertSegments';

function NotificationItem({ notification, onClose, onDismiss, onSnooze }) {
  return (
    <div
      className={`p-3 rounded-lg border ${
        notification._isBackend
          ? notification.notifType === 'error'   ? 'border-red-200 bg-red-50'
          : notification.notifType === 'warning' ? 'border-yellow-200 bg-yellow-50'
          : notification.notifType === 'success' ? 'border-green-200 bg-green-50'
          : 'border-indigo-200 bg-indigo-50'
          : notification.priority === 'high'   ? 'border-red-200 bg-red-50'
          : notification.priority === 'medium' ? 'border-yellow-200 bg-yellow-50'
          : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {notification._isBackend && (
            <div className="flex items-center gap-1 mb-1">
              <Megaphone className="w-3 h-3 text-indigo-500" />
              <span className="text-[10px] text-indigo-600 font-medium">הודעה ממנהל</span>
            </div>
          )}
          <h4 className="text-sm font-medium text-gray-900">
            {notification.title}
          </h4>
          <p className="text-xs text-gray-600 mt-1">
            {notification.description}
          </p>
          {notification.link && (
            <Link
              to={notification.link}
              className="text-xs text-blue-600 hover:underline mt-1 inline-block"
              onClick={onClose}
            >
              צפייה בפרטים
            </Link>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 relative z-10">
              <MoreVertical className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="relative z-50">
            <DropdownMenuItem
              onClick={() => onSnooze(notification.id)}
              className="text-xs"
            >
              <Clock className="w-3 h-3 mr-1" />
              דחה עד מחר
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDismiss(notification.id)}
              className="text-xs text-red-600"
            >
              <X className="w-3 h-3 mr-1" />
              בטל התראה
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default function NotificationPanel({
  notifications,
  isOpen,
  onClose,
  onDismiss,
  onSnooze
}) {
  if (!isOpen) return null;

  // קיבוץ ההתראות לפי סגמנט: אגרונומי / עובדים / תפעולי
  const groups = {};
  (notifications || []).forEach(n => {
    const seg = n.segment || segmentForType(n.type);
    (groups[seg] = groups[seg] || []).push(n);
  });
  const orderedSegments = ALERT_SEGMENT_ORDER.filter(seg => (groups[seg] || []).length > 0);

  return (
    <div className="absolute top-12 left-0 w-80 bg-white border rounded-lg shadow-lg z-40">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">התראות</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[400px] relative z-0">
        <div className="p-2 space-y-4">
          {notifications.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>אין התראות חדשות</p>
            </div>
          ) : (
            orderedSegments.map(seg => {
              const meta = segmentMeta(seg);
              const items = groups[seg];
              return (
                <div key={seg} className="space-y-2">
                  <div className="flex items-center gap-2 px-1 sticky top-0 bg-white/95 backdrop-blur-sm py-1 z-[1]">
                    <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                    <span className={`text-xs font-semibold ${meta.text}`}>{meta.label}</span>
                    <span className="text-[10px] text-gray-400">({items.length})</span>
                    <span className="flex-1 h-px bg-gray-100" />
                  </div>
                  {items.map(notification => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onClose={onClose}
                      onDismiss={onDismiss}
                      onSnooze={onSnooze}
                    />
                  ))}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
