
import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Sprout, Map, MoreHorizontal, Plus, Users2,
  SlidersHorizontal, Layers, Truck, Settings, X, ChevronRight,
  Scissors, ClipboardList, Leaf, Activity, Scale
} from "lucide-react";

// ─── Navigation items ───────────────────────────────────────────────────────
const mainNav = [
  { name: "בקרה",   icon: LayoutDashboard,   path: "Dashboard" },
  { name: "מזרעים", icon: Sprout,             path: "Seedings" },
  null, // FAB placeholder
  { name: "חלקות",  icon: Map,               path: "Plots" },
  { name: "עוד",    icon: MoreHorizontal,    path: null },
];

const moreNav = [
  { name: "עובדים",          icon: Users2,            path: "Employees" },
  { name: "יריעות",           icon: Layers,            path: "Sheets" },
  { name: "שקילה",            icon: Scale,             path: "WeighingCertificates" },
  { name: "רכבים",            icon: Truck,             path: "Vehicles" },
  { name: "הגדרות",           icon: Settings,          path: "Settings" },
];

const quickActions = [
  { name: "מזרע חדש",       icon: Sprout,        path: "Seedings",             param: "?create=true", color: "bg-green-500" },
  { name: "הוסף קטיף",     icon: Scissors,      path: "Seedings",             param: "",            color: "bg-amber-500" },
  { name: "אסמכתא שקילה",  icon: Scale,         path: "WeighingCertificates", param: "?create=true", color: "bg-blue-500" },
  { name: "עובד חדש",       icon: Users2,        path: "AddEmployee",          param: "",            color: "bg-purple-500" },
  { name: "פעילות שדה",    icon: Activity,      path: "Seedings",             param: "",            color: "bg-orange-500" },
];

export default function BottomNav({ onQuickAction }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);

  const isActive = (path) => {
    if (!path) return false;
    return location.pathname.startsWith(createPageUrl(path));
  };

  const isMoreActive = moreNav.some(item => isActive(item.path));

  const handleQuickAction = (action) => {
    setFabOpen(false);
    const url = createPageUrl(action.path) + (action.param || "");
    navigate(url);
    if (onQuickAction) onQuickAction(action);
  };

  return (
    <>
      {/* ── FAB overlay backdrop ──────────────────────────────────────────── */}
      {(fabOpen || moreOpen) && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => { setFabOpen(false); setMoreOpen(false); }}
        />
      )}

      {/* ── FAB quick-add sheet ───────────────────────────────────────────── */}
      <div
        className={cn(
          "fixed bottom-16 inset-x-0 z-50 lg:hidden transition-all duration-300",
          fabOpen ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0 pointer-events-none"
        )}
      >
        <div className="mx-4 mb-2 bg-white rounded-2xl shadow-2xl border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
            <span className="font-semibold text-gray-800 text-sm">פעולה מהירה</span>
            <button
              onClick={() => setFabOpen(false)}
              className="p-1 rounded-full hover:bg-gray-200 text-gray-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-3 grid grid-cols-1 gap-2">
            {quickActions.map((action) => (
              <button
                key={action.name}
                onClick={() => handleQuickAction(action)}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 active:bg-gray-100 text-right w-full transition-colors"
              >
                <span className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0", action.color)}>
                  <action.icon className="w-4 h-4 text-white" />
                </span>
                <span className="text-sm font-medium text-gray-800">{action.name}</span>
                <ChevronRight className="w-4 h-4 text-gray-400 mr-auto rotate-180" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── More sheet ────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "fixed bottom-16 inset-x-0 z-50 lg:hidden transition-all duration-300",
          moreOpen ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0 pointer-events-none"
        )}
      >
        <div className="mx-4 mb-2 bg-white rounded-2xl shadow-2xl border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
            <span className="font-semibold text-gray-800 text-sm">עוד אפשרויות</span>
            <button
              onClick={() => setMoreOpen(false)}
              className="p-1 rounded-full hover:bg-gray-200 text-gray-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-2 grid grid-cols-3 gap-1">
            {moreNav.map((item) => (
              <Link
                key={item.name}
                to={createPageUrl(item.path)}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-xl transition-colors",
                  isActive(item.path)
                    ? "bg-indigo-50 text-indigo-600"
                    : "hover:bg-gray-50 text-gray-600"
                )}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-xs font-medium">{item.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom Navigation Bar ─────────────────────────────────────────── */}
      <nav className="fixed bottom-0 inset-x-0 h-16 bg-white border-t shadow-lg z-50 lg:hidden safe-area-bottom">
        <div className="flex h-full items-center justify-around px-1">
          {mainNav.map((item, index) => {
            // ── FAB center button ──
            if (!item) {
              return (
                <button
                  key="fab"
                  onClick={() => { setFabOpen(v => !v); setMoreOpen(false); }}
                  className={cn(
                    "relative -top-4 flex items-center justify-center w-14 h-14 rounded-full shadow-lg transition-all duration-200",
                    fabOpen
                      ? "bg-red-500 rotate-45 scale-95"
                      : "bg-indigo-600 hover:bg-indigo-700 active:scale-95"
                  )}
                  aria-label="פעולה מהירה"
                >
                  <Plus className="w-6 h-6 text-white" />
                </button>
              );
            }

            // ── "More" button ──
            if (item.path === null) {
              return (
                <button
                  key="more"
                  onClick={() => { setMoreOpen(v => !v); setFabOpen(false); }}
                  className={cn(
                    "flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors min-w-[48px]",
                    (isMoreActive || moreOpen) ? "text-indigo-600" : "text-gray-500"
                  )}
                >
                  {moreOpen
                    ? <X className="w-5 h-5" />
                    : <MoreHorizontal className="w-5 h-5" />
                  }
                  <span className="text-[10px] font-medium leading-none">עוד</span>
                </button>
              );
            }

            // ── Regular nav item ──
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={createPageUrl(item.path)}
                onClick={() => { setMoreOpen(false); setFabOpen(false); }}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors min-w-[48px]",
                  active ? "text-indigo-600" : "text-gray-500 hover:text-gray-700"
                )}
              >
                <div className="relative">
                  <item.icon className={cn("w-5 h-5", active && "stroke-[2.5]")} />
                  {active && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-600" />
                  )}
                </div>
                <span className={cn("text-[10px] font-medium leading-none", active && "font-semibold")}>
                  {item.name}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
