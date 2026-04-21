import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Bell, Menu, User as UserIcon, LogOut, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { User } from "@/entities/all";
import NotificationPanel from "./NotificationPanel";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function TopBar({ 
  onMenuClick, 
  currentUser, 
  currentFarm,
  companySettings,
  getUserInitials, 
  notifications, 
  onDismissNotification, 
  onSnoozeNotification,
  farmSelector 
}) {
  const [showNotifications, setShowNotifications] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await User.logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <div className="bg-white border-b px-3 lg:px-6 h-14 lg:h-16 flex items-center justify-between sticky top-0 z-30">
      {/* Right section (RTL) - Title + Farm Selector */}
      <div className="flex items-center gap-2 lg:gap-4 min-w-0">
        {/* Hamburger only on desktop sidebar */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden"
          onClick={onMenuClick}
        >
          <Menu className="h-6 w-6" />
        </Button>

        {/* App icon on mobile */}
        <div className="flex items-center gap-2 lg:hidden">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-white fill-current">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/>
            </svg>
          </div>
        </div>

        <h1 className="text-sm lg:text-lg font-semibold text-gray-800 hidden lg:block whitespace-nowrap">
          מערכת ניהול המשק
        </h1>

        {/* Farm Selector */}
        <div className="min-w-0">
          {farmSelector}
        </div>
      </div>

      {/* Left section (RTL) - Notifications + User */}
      <div className="flex items-center gap-1 lg:gap-3 flex-shrink-0">
        {/* Notifications */}
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative h-9 w-9 lg:h-10 lg:w-10"
          >
            <Bell className="h-4 w-4 lg:h-5 lg:w-5" />
            {notifications.length > 0 && (
              <Badge className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full p-0 text-[10px] bg-red-500">
                {notifications.length > 9 ? "9+" : notifications.length}
              </Badge>
            )}
          </Button>

          <NotificationPanel
            notifications={notifications}
            isOpen={showNotifications}
            onClose={() => setShowNotifications(false)}
            onDismiss={onDismissNotification}
            onSnooze={onSnoozeNotification}
          />
        </div>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-1.5 lg:px-3 h-9 lg:h-10">
              <Avatar className="h-7 w-7 lg:h-8 lg:w-8">
                <AvatarImage src={currentUser?.avatar_url} alt={currentUser?.full_name} />
                <AvatarFallback className="text-xs">
                  {getUserInitials(currentUser?.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className="text-right hidden lg:block">
                <div className="text-sm font-medium leading-tight">{currentUser?.full_name}</div>
                {currentFarm && (
                  <div className="text-xs text-gray-500 leading-tight">{currentFarm.name}</div>
                )}
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-2">
              <div className="text-sm font-medium">{currentUser?.full_name}</div>
              <div className="text-xs text-gray-500">{currentUser?.email}</div>
              {currentFarm && (
                <div className="text-xs text-blue-600 mt-1">משק פעיל: {currentFarm.name}</div>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <UserIcon className="h-4 w-4 mr-2" />
              הפרופיל שלי
            </DropdownMenuItem>
            {currentUser?.is_admin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => navigate(createPageUrl('AdminPanel'))}
                  className="text-red-700 font-medium"
                >
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  ניהול מערכת
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-red-600">
              <LogOut className="h-4 w-4 mr-2" />
              התנתק
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}