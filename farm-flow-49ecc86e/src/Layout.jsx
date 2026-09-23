
import React, { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { LayoutDashboard, Users, Menu, X, Sprout, Settings, Map, SlidersHorizontal, Layers, Users2, Building, Truck, ShieldCheck, Clock, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { User, CompanySettings, Employee, PlasticSheet, Seeding, Farm, Subscription, Vehicle } from "@/entities/all";
import { getMeCached, getFarmCached } from "@/api/cachedReads";
import { batchFetch } from "@/api/localClient";
import { segmentForType } from "./components/layout/alertSegments";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import TopBar from "./components/layout/TopBar";
import BottomNav from "./components/layout/BottomNav";
import WelcomeScreen from './components/onboarding/WelcomeScreen';
import FarmSelector from './components/layout/FarmSelector';
import ErrorBoundary from './components/ErrorBoundary';
import { addDays, differenceInDays, parseISO, startOfTomorrow, format } from 'date-fns';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = React.useState(false); // desktop only
  const [currentUser, setCurrentUser] = useState(null);
  const [currentFarm, setCurrentFarm] = useState(null);
  const [companySettings, setCompanySettings] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [backendNotifications, setBackendNotifications] = useState([]);
  const [showWelcome, setShowWelcome] = useState(false);
  const [dismissedNotifications, setDismissedNotifications] = useState(() => {
    const saved = localStorage.getItem('dismissedNotifications');
    return saved ? JSON.parse(saved) : {};
  });
  const location = useLocation();

  useEffect(() => {
    localStorage.setItem('dismissedNotifications', JSON.stringify(dismissedNotifications));
  }, [dismissedNotifications]);

  const generateNotifications = useCallback(async () => {
    if (!currentFarm) return;

    const thirtyDaysFromNow = addDays(new Date(), 30);
    const generated = [];

    try {
      // Fetch all notification sources in parallel (was 5 serial round-trips)
      // בקשת רשת אחת במקום חמש (כל סבב דרך Cloudflare עולה ~0.4 שנ')
      const [employees, sheets, seedings, vehicles, subscriptions] = await batchFetch([
        { entity: 'employees', filter: { farm_id: currentFarm.id } },
        { entity: 'plastic_sheets', filter: { farm_id: currentFarm.id } },
        { entity: 'seedings', filter: { farm_id: currentFarm.id, status: 'ordered' } },
        { entity: 'vehicles', filter: { farm_id: currentFarm.id } },
        { entity: 'subscriptions', filter: { farm_id: currentFarm.id } },
      ]).catch(() => [[], [], [], [], []]);

      // Employee notifications - only employees from the current farm
      const safeEmployees = Array.isArray(employees) ? employees : [];
      
      safeEmployees.forEach(emp => {
        if (!emp) return; // Safety check for null/undefined employee objects
        
        const checkDate = (dateStr, type, description) => {
          if (!dateStr) return;
          try {
            const date = parseISO(dateStr);
            if (date <= thirtyDaysFromNow) {
              generated.push({
                id: `employee-${emp.id}-${type}`,
                title: `${description} ל${emp.full_name}`,
                description: `תוקף: ${format(date, 'dd/MM/yyyy')}`,
                dueDate: date,
                type: 'employee',
                link: createPageUrl(`EmployeeDetail?id=${emp.id}`)
              });
            }
          } catch (error) {
            console.warn(`Error parsing ${type} date for employee ${emp.id}:`, dateStr, error);
          }
        };
        
        checkDate(emp.visa_expiry, 'visa', 'ויזה עומדת לפוג');
        checkDate(emp.passport_expiry, 'passport', 'דרכון עומד לפוג');
        if (emp.insurance_details?.policy_end_date) {
          checkDate(emp.insurance_details.policy_end_date, 'insurance', 'ביטוח עומד לפוג');
        }
      });

      // Sheet notifications - only sheets from the current farm
      const safeSheets = Array.isArray(sheets) ? sheets : [];
      
      safeSheets.forEach(sheet => {
        if (!sheet) return; // Safety check for null/undefined sheet objects
        
        if (sheet.installation_date && sheet.replacement_cycle_months) {
          try {
            const expectedReplacement = addDays(parseISO(sheet.installation_date), sheet.replacement_cycle_months * 30);
            if (expectedReplacement <= thirtyDaysFromNow) {
              generated.push({
                id: `sheet-${sheet.id}`,
                title: `החלפת יריעה ${sheet.sheet_number} בחלקה`,
                description: `תאריך החלפה משוער: ${format(expectedReplacement, 'dd/MM/yyyy')}`,
                dueDate: expectedReplacement,
                type: 'sheet',
                link: createPageUrl(`Plots`)
              });
            }
          } catch (error) {
            console.warn(`Error calculating sheet replacement date for sheet ${sheet.id}:`, error);
          }
        }
      });

      // Seeding notifications - only seedings from the current farm
      const safeSeedings = Array.isArray(seedings) ? seedings : [];
      
      safeSeedings.forEach(seeding => {
        if (!seeding) return; // Safety check for null/undefined seeding objects
        
        if (seeding.planting_date) {
          try {
            const plantingDate = parseISO(seeding.planting_date);
            if (plantingDate <= thirtyDaysFromNow) {
              generated.push({
                id: `seeding-${seeding.id}`,
                title: `שתילה למזרע ${seeding.name}`,
                description: `תאריך שתילה מתוכנן: ${format(plantingDate, 'dd/MM/yyyy')}`,
                dueDate: plantingDate,
                type: 'seeding',
                link: createPageUrl(`SeedingDetail?id=${seeding.id}`)
              });
            }
          } catch (error) {
            console.warn(`Error parsing seeding planting date for seeding ${seeding.id}:`, error);
          }
        }
      });

      // Vehicle notifications (תפעולי) — ביטוח חובה, ביטוח מקיף, וטסט
      const safeVehicles = Array.isArray(vehicles) ? vehicles : [];

      safeVehicles.forEach(veh => {
        if (!veh || veh.status === 'sold' || veh.status === 'out_of_order') return;

        const checkVehicleDate = (dateStr, suffix, description) => {
          if (!dateStr) return;
          try {
            const date = parseISO(dateStr);
            if (date <= thirtyDaysFromNow) {
              generated.push({
                id: `vehicle-${veh.id}-${suffix}`,
                title: `${description} — ${veh.name || veh.license_plate || 'רכב'}`,
                description: `תוקף: ${format(date, 'dd/MM/yyyy')}`,
                dueDate: date,
                type: 'vehicle',
                link: createPageUrl(`VehicleDetail?id=${veh.id}`)
              });
            }
          } catch (error) {
            console.warn(`Error parsing vehicle ${suffix} date for vehicle ${veh.id}:`, dateStr, error);
          }
        };

        checkVehicleDate(veh.insurance_compulsory?.end_date, 'compulsory', 'ביטוח חובה עומד לפוג');
        checkVehicleDate(veh.insurance_info?.end_date, 'comprehensive', 'ביטוח מקיף עומד לפוג');
        checkVehicleDate(veh.licensing_info?.next_test_date, 'test', 'טסט עומד לפוג');
      });

      // Subscription notifications (subscriptions already fetched in the parallel batch above)
      try {
        const safeSubscriptions = Array.isArray(subscriptions) ? subscriptions : [];
        
        safeSubscriptions.forEach(subscription => {
          if (!subscription) return; // Safety check for null/undefined subscription objects
          
          if (subscription.end_date) {
            try {
              const endDate = parseISO(subscription.end_date);
              const daysUntilExpiry = differenceInDays(endDate, new Date());
              
              if (daysUntilExpiry <= 30 && daysUntilExpiry >= 0) {
                generated.push({
                  id: `subscription-${subscription.id}-expiry`,
                  title: `מנוי ${subscription.plan_name} עומד לפוג`,
                  description: `פג תוקף ב-${format(endDate, 'dd/MM/yyyy')} (עוד ${daysUntilExpiry} ימים)`,
                  dueDate: endDate,
                  type: 'subscription',
                  link: createPageUrl(`Settings?tab=subscription`),
                  priority: daysUntilExpiry <= 7 ? 'high' : 'medium'
                });
              }
              
              if (daysUntilExpiry < 0 && subscription.status !== 'expired') {
                generated.push({
                  id: `subscription-${subscription.id}-expired`,
                  title: `מנוי ${subscription.plan_name} פג תוקף`,
                  description: `המנוי פג ב-${format(endDate, 'dd/MM/yyyy')}`,
                  dueDate: endDate,
                  type: 'subscription',
                  link: createPageUrl(`Settings?tab=subscription`),
                  priority: 'high'
                });
              }
            } catch (error) {
              console.warn(`Error parsing subscription end date for subscription ${subscription.id}:`, error);
            }
          }
          
          if (subscription.status === 'pending_payment') {
            generated.push({
              id: `subscription-${subscription.id}-payment`,
              title: `תשלום מנוי ממתין`,
              description: `נדרש תשלום עבור מנוי ${subscription.plan_name}`,
              dueDate: new Date(),
              type: 'subscription',
              link: createPageUrl(`Settings?tab=subscription`),
              priority: 'high'
            });
          }
        });
      } catch (subscriptionError) {
        // Silently handle subscription entity errors - it might not exist yet
        console.info('Subscription notifications not available:', subscriptionError.message);
      }

    } catch (error) {
      console.error('Error generating notifications:', error);
    }

    const now = new Date();
    const activeNotifications = generated
      .map(n => ({ ...n, segment: n.segment || segmentForType(n.type) }))
      .filter(n => {
        if (!n) return false; // Safety check for null/undefined notification objects
        const dismissedState = dismissedNotifications[n.id];
        if (!dismissedState) return true;
        if (dismissedState.type === 'dismissed') return false;
        if (dismissedState.type === 'snoozed' && new Date(dismissedState.until) > now) return false;
        return true;
      })
      .sort((a, b) => {
        // מיון לפי עדיפות ואז לפי תאריך
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const priorityDiff = (priorityOrder[b?.priority] || 1) - (priorityOrder[a?.priority] || 1); // Added optional chaining for safety
        if (priorityDiff !== 0) return priorityDiff;
        // Ensure dueDate exists before comparison
        if (!a?.dueDate || !b?.dueDate) return 0;
        return a.dueDate.getTime() - b.dueDate.getTime();
      });

    setNotifications(activeNotifications);
  }, [dismissedNotifications, currentFarm]);

  useEffect(() => {
    const fetchData = async () => {
        try {
            const user = await getMeCached();
            setCurrentUser(user);

            // Check if user has any farms
            if (!user.farm_ids || user.farm_ids.length === 0) {
              setShowWelcome(true);
              return;
            }

            // Load the current farm
            let currentFarmToSet = null;
            if (user.current_farm_id) {
              try {
                currentFarmToSet = await getFarmCached(user.current_farm_id);
              } catch (error) {
                console.warn('Could not load current farm, trying first available:', error);
              }
            }

            // If failed to load current farm, take the first one from the list
            if (!currentFarmToSet && user.farm_ids.length > 0) {
              try {
                currentFarmToSet = await getFarmCached(user.farm_ids[0]);
                // Update the active farm in the user's data
                await User.updateMyUserData({ current_farm_id: currentFarmToSet.id });
              } catch (error) {
                console.error('Could not load any farm:', error);
                setShowWelcome(true);
                return;
              }
            }
            
            setCurrentFarm(currentFarmToSet);
            // Note: Company settings are not explicitly fetched here anymore per outline.
            // If they are farm-specific, this logic needs adjustment.
            // For now, companySettings will remain null unless set elsewhere.

        } catch (e) {
            console.error("Failed to fetch layout data:", e);
        }
    };
    fetchData();
  }, []);

  // Load notifications only after currentFarm is loaded
  useEffect(() => {
    if (currentFarm) {
      generateNotifications();
      // Refresh notifications every hour
      const interval = setInterval(generateNotifications, 1000 * 60 * 60);
      return () => clearInterval(interval);
    }
  }, [generateNotifications, currentFarm]);

  // Fetch backend notifications (admin/manager sent messages)
  const fetchBackendNotifications = useCallback(async () => {
    const token = localStorage.getItem('farm_flow_token');
    if (!token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setBackendNotifications(data.map(n => ({
        id: `backend-${n.id}`,
        _backendId: n.id,
        _isBackend: true,
        title: n.title,
        description: n.body || (n.sender_name ? `מאת: ${n.sender_name}` : ''),
        dueDate: new Date(n.created_at),
        type: 'admin',
        segment: 'operational',
        priority: n.type === 'error' ? 'high' : n.type === 'warning' ? 'medium' : 'low',
        notifType: n.type,
      })));
    } catch (e) {
      console.warn('Backend notifications unavailable:', e.message);
    }
  }, []);

  useEffect(() => {
    fetchBackendNotifications();
    const interval = setInterval(fetchBackendNotifications, 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchBackendNotifications]);

  const handleDismissNotification = async (notificationId) => {
    const allNotifs = [...backendNotifications, ...notifications];
    const notif = allNotifs.find(n => n.id === notificationId);
    if (notif?._isBackend) {
      const token = localStorage.getItem('farm_flow_token');
      try {
        await fetch(`${BACKEND_URL}/notifications/${notif._backendId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        setBackendNotifications(prev => prev.filter(n => n.id !== notificationId));
      } catch (e) { console.warn('Failed to dismiss backend notification:', e); }
    } else {
      setDismissedNotifications(prev => ({ ...prev, [notificationId]: { type: 'dismissed' } }));
    }
  };

  const handleSnoozeNotification = async (notificationId) => {
    const allNotifs = [...backendNotifications, ...notifications];
    const notif = allNotifs.find(n => n.id === notificationId);
    if (notif?._isBackend) {
      const token = localStorage.getItem('farm_flow_token');
      try {
        await fetch(`${BACKEND_URL}/notifications/${notif._backendId}/read`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
        });
        setBackendNotifications(prev => prev.filter(n => n.id !== notificationId));
      } catch (e) { console.warn('Failed to snooze backend notification:', e); }
    } else {
      setDismissedNotifications(prev => ({
        ...prev,
        [notificationId]: { type: 'snoozed', until: startOfTomorrow().toISOString() }
      }));
    }
  };

  const handleFarmChange = async (farm) => {
    console.log('Layout - Changing farm to:', farm);
    
    // Clear all state before switching
    setCurrentFarm(null);
    setNotifications([]);
    
    // Small delay to ensure state is cleared
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Set new farm
    setCurrentFarm(farm);
    
    // Force page reload to ensure all components refresh with new farm
    window.location.reload();
  };

  const handleFarmCreated = (newFarm) => {
    setCurrentFarm(newFarm);
    setShowWelcome(false);
    // The WelcomeScreen will reload the page, so no need to do anything else here
  };

  // If welcome screen needs to be displayed
  if (showWelcome) {
    return <WelcomeScreen currentUser={currentUser} onFarmCreated={handleFarmCreated} />;
  }

  const navigation = [
    { name: "לוח בקרה", icon: LayoutDashboard, path: "Dashboard" },
    { name: "עובדים", icon: Users2, path: "Employees" },
    { name: "שעון נוכחות", icon: Clock, path: "Attendance" },
    { name: "מזרעים", icon: Sprout, path: "Seedings" },
    { name: "חלקות", icon: Map, path: "Plots" },
    { name: "יריעות", icon: Layers, path: "Sheets" },
    { name: "אסמכתאות שקילה", icon: SlidersHorizontal, path: "WeighingCertificates" },
    { name: "רכבים", icon: Truck, path: "Vehicles" },
    { name: "חשבוניות", icon: FileText, path: "Invoices" },
    { name: "ספקים", icon: Building, path: "Suppliers" },
    { name: "חברי משק", icon: Users, path: "FarmMembers" },
    { name: "הגדרות", icon: Settings, path: "Settings" },
    ...(currentUser?.is_admin ? [{ name: "ניהול מערכת", icon: ShieldCheck, path: "AdminPanel", adminOnly: true }] : []),
  ];

  const isActive = (path) => {
    return location.pathname.startsWith(createPageUrl(path));
  };
  
  const getUserInitials = (name) => {
      if (!name) return "?";
      return name.split(' ').map(n => n[0]).join('');
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-gray-50" dir="rtl">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex lg:w-16 hover:lg:w-60 transition-all duration-300 group">
          <div className="flex h-full flex-col justify-between bg-white border-l shadow-sm">
            <div>
              <div className="flex h-16 items-center justify-center group-hover:justify-start group-hover:px-6 border-b">
                <Sprout className="h-8 w-8 text-indigo-600" />
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-xl font-semibold mr-3 whitespace-nowrap">
                  מנהל
                </span>
              </div>
              <nav className="flex-1 space-y-1 p-2">
                {navigation.map((item) => (
                  <Link
                    key={item.name}
                    to={createPageUrl(item.path)}
                    className={cn(
                      "flex items-center rounded-lg px-3 py-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors",
                      isActive(item.path) && "bg-gray-100 text-gray-900"
                    )}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 mr-3 whitespace-nowrap">
                      {item.name}
                    </span>
                  </Link>
                ))}
              </nav>
            </div>
            
            {currentUser && (
              <div className="border-t p-2">
                <div className="flex items-center rounded-lg px-3 py-2">
                  <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarFallback>{getUserInitials(currentUser.full_name)}</AvatarFallback>
                  </Avatar>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 mr-3 whitespace-nowrap overflow-hidden">
                      <div className="text-sm font-semibold truncate">{currentUser.full_name}</div>
                      <div className="text-xs text-gray-500 truncate">{currentUser.email}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
          <TopBar
            onMenuClick={() => setSidebarOpen(true)}
            currentUser={currentUser}
            currentFarm={currentFarm}
            companySettings={companySettings}
            getUserInitials={getUserInitials}
            notifications={[...backendNotifications, ...notifications]}
            onDismissNotification={handleDismissNotification}
            onSnoozeNotification={handleSnoozeNotification}
            farmSelector={
              <FarmSelector
                currentUser={currentUser}
                currentFarm={currentFarm}
                onFarmChange={handleFarmChange}
              />
            }
          />
          {/* Extra bottom padding on mobile for BottomNav */}
          <main className="flex-1 overflow-auto bg-gray-50 pb-16 lg:pb-0">
            <ErrorBoundary>
              {currentFarm || ['AdminPanel', 'FarmMembers'].includes(currentPageName) ? (
                <div key={currentFarm?.id || 'admin'}>
                  {children}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <Building className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-semibold text-gray-900">אין משק פעיל</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      יש לבחור או ליצור משק כדי להתחיל לעבוד
                    </p>
                  </div>
                </div>
              )}
            </ErrorBoundary>
          </main>
        </div>

        {/* Bottom Navigation - mobile only */}
        <BottomNav />
      </div>
    </ErrorBoundary>
  );
}
