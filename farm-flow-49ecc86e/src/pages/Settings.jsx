
import React, { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Building,
  Package,
  Sprout,
  Leaf,
  Activity,
  Package2,
  Users,
  Box,
  Layers,
  Droplet,
  FileText,
  Building2,
  Printer,
  UserCog,
  CreditCard,
  Loader2,
  Brain,
  Cpu,
  Send,
  Mail,
  Clock,
  Receipt
} from "lucide-react";

import CompanySettingsManager from "../components/settings/CompanySettingsManager";
import UsersManager from "../components/settings/UsersManager";
import VarietiesManager from "../components/settings/VarietiesManager";
import CropsManager from "../components/settings/CropsManager";
import PackagingManager from "../components/settings/PackagingManager";
import PesticidesManager from "../components/settings/PesticidesManager";
import PalletTypesManager from "../components/settings/PalletTypesManager";
import SheetTypesManager from "../components/settings/SheetTypesManager";
import ManpowerCompaniesManager from '../components/settings/ManpowerCompaniesManager';
import SubscriptionManager from '../components/settings/SubscriptionManager';
import CustomersManager from "../components/settings/CustomersManager";
import ProductsManager from "../components/settings/ProductsManager";
import ActivityTypesManager from "../components/settings/ActivityTypesManager";
import PrinterSettings from '../components/settings/PrinterSettings';
import InputTypesManager from '../components/settings/InputTypesManager';
import AISettingsManager from '../components/settings/AISettingsManager';
import GmailSettingsManager from '../components/settings/GmailSettingsManager';
import BookkeeperSettingsManager from '../components/settings/BookkeeperSettingsManager';
import AttendanceSettingsManager from '../components/settings/AttendanceSettingsManager';
import SensorManager from '../components/settings/SensorManager';
import TelegramSettings from '../components/settings/TelegramSettings';
import { User, Farm } from '@/entities/all';

export default function Settings() {
  const location = useLocation();
  const navigate = useNavigate();

  const getTabFromQuery = useCallback(() => {
    const params = new URLSearchParams(location.search);
    return params.get('tab') || 'company';
  }, [location.search]);

  const [activeTab, setActiveTab] = useState(getTabFromQuery());
  const [currentFarm, setCurrentFarm] = useState(null);
  const [isLoadingFarm, setIsLoadingFarm] = useState(true);

  useEffect(() => {
    setActiveTab(getTabFromQuery());
  }, [getTabFromQuery]);

  useEffect(() => {
    loadCurrentFarm();
  }, []);

  const loadCurrentFarm = async () => {
    setIsLoadingFarm(true);
    try {
      const user = await User.me();
      console.log('Settings - Current user:', user);
      
      if (user?.current_farm_id) {
        const farm = await Farm.get(user.current_farm_id);
        console.log('Settings - Loaded current farm:', farm);
        setCurrentFarm(farm);
      } else {
        console.warn('Settings - No current_farm_id found for user');
        setCurrentFarm(null);
      }
    } catch (error) {
      console.error('Settings - Failed to load current farm:', error);
      setCurrentFarm(null);
    } finally {
      setIsLoadingFarm(false);
    }
  };

  const handleTabChange = (value) => {
    setActiveTab(value);
    navigate(`${location.pathname}?tab=${value}`);
  };

  if (isLoadingFarm) {
    return (
      <div className="p-4 sm:p-6 lg:p-8" dir="rtl">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <span className="mr-3">טוען הגדרות...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!currentFarm) {
    return (
      <div className="p-4 sm:p-6 lg:p-8" dir="rtl">
        <div className="max-w-7xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>הגדרות</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-center py-8 text-gray-500">
                לא נמצא משק פעיל. אנא בחר משק מהתפריט העליון.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 lg:p-8" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-3 lg:mb-6">
          <h1 className="text-xl lg:text-3xl font-bold">הגדרות{currentFarm ? ` — ${currentFarm.name}` : ''}</h1>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <div className="relative mb-4 lg:mb-6">
            <div className="overflow-x-auto pb-1 -mx-3 px-3 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
              <TabsList className="inline-flex w-auto gap-1 bg-transparent">
                <TabsTrigger value="company" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Building className="w-3.5 h-3.5" />
                  <span>חברה</span>
                </TabsTrigger>
                <TabsTrigger value="products" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Package className="w-3.5 h-3.5" />
                  <span>מוצרים</span>
                </TabsTrigger>
                <TabsTrigger value="crops" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Sprout className="w-3.5 h-3.5" />
                  <span>גידולים</span>
                </TabsTrigger>
                <TabsTrigger value="varieties" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Leaf className="w-3.5 h-3.5" />
                  <span>זנים</span>
                </TabsTrigger>
                <TabsTrigger value="activity_types" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Activity className="w-3.5 h-3.5" />
                  <span>פעילויות</span>
                </TabsTrigger>
                <TabsTrigger value="input_types" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Package2 className="w-3.5 h-3.5" />
                  <span>תשומות</span>
                </TabsTrigger>
                <TabsTrigger value="customers" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Users className="w-3.5 h-3.5" />
                  <span>לקוחות</span>
                </TabsTrigger>
                <TabsTrigger value="packaging" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Box className="w-3.5 h-3.5" />
                  <span>אריזות</span>
                </TabsTrigger>
                <TabsTrigger value="pallet_types" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Layers className="w-3.5 h-3.5" />
                  <span>משטחים</span>
                </TabsTrigger>
                <TabsTrigger value="pesticides" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Droplet className="w-3.5 h-3.5" />
                  <span>הדברה</span>
                </TabsTrigger>
                <TabsTrigger value="sheet_types" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <FileText className="w-3.5 h-3.5" />
                  <span>יריעות</span>
                </TabsTrigger>
                <TabsTrigger value="manpower_companies" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>חברות כ"א</span>
                </TabsTrigger>
                <TabsTrigger value="printer" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Printer className="w-3.5 h-3.5" />
                  <span>מדפסת</span>
                </TabsTrigger>
                <TabsTrigger value="users" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <UserCog className="w-3.5 h-3.5" />
                  <span>משתמשים</span>
                </TabsTrigger>
                <TabsTrigger value="subscription" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>מנוי</span>
                </TabsTrigger>
                <TabsTrigger value="attendance" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Clock className="w-3.5 h-3.5" />
                  <span>שעון נוכחות</span>
                </TabsTrigger>
                <TabsTrigger value="ai" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Brain className="w-3.5 h-3.5" />
                  <span>AI</span>
                </TabsTrigger>
                <TabsTrigger value="sensors" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>חיישנים</span>
                </TabsTrigger>
                <TabsTrigger value="telegram" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Send className="w-3.5 h-3.5" />
                  <span>טלגרם</span>
                </TabsTrigger>
                <TabsTrigger value="gmail" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Mail className="w-3.5 h-3.5" />
                  <span>Gmail</span>
                </TabsTrigger>
                <TabsTrigger value="bookkeeper" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <Receipt className="w-3.5 h-3.5" />
                  <span>חשבוניות</span>
                </TabsTrigger>
              </TabsList>
            </div>
          </div>

          <TabsContent value="company">
            <CompanySettingsManager currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="products">
            <ProductsManager currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="crops">
            <CropsManager currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="varieties">
            <VarietiesManager currentFarm={currentFarm} onNavigateToTab={handleTabChange} />
          </TabsContent>
          <TabsContent value="activity_types">
            <ActivityTypesManager currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="input_types">
            <InputTypesManager currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="customers">
            <CustomersManager currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="packaging">
            <PackagingManager currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="pallet_types">
            <PalletTypesManager currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="pesticides">
            <PesticidesManager />
          </TabsContent>
          <TabsContent value="sheet_types">
            <SheetTypesManager currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="manpower_companies">
            <ManpowerCompaniesManager currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="printer">
            <PrinterSettings currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="users">
            <UsersManager />
          </TabsContent>
          <TabsContent value="subscription">
            <SubscriptionManager currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="attendance">
            <AttendanceSettingsManager currentFarm={currentFarm} />
          </TabsContent>
          <TabsContent value="ai">
            <AISettingsManager />
          </TabsContent>
          <TabsContent value="sensors">
            <SensorManager />
          </TabsContent>
          <TabsContent value="telegram">
            <TelegramSettings />
          </TabsContent>
          <TabsContent value="gmail">
            <GmailSettingsManager />
          </TabsContent>
          <TabsContent value="bookkeeper">
            <BookkeeperSettingsManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
