
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ExternalLink, TrendingUp } from "lucide-react";

export default function SeedingSummary({ activities, harvests }) {
  // Safe array handling
  const safeActivities = Array.isArray(activities) ? activities : [];
  const safeHarvests = Array.isArray(harvests) ? harvests : [];
  
  // Renamed from totalActivitiesCost to totalActivityCost for consistency with outline's display name
  const totalActivityCost = safeActivities.reduce((sum, activity) => sum + (activity.total_cost || 0), 0);
  
  // New calculation for total activity area, assuming 'area_dunams' property on activity
  const totalActivityArea = safeActivities.reduce((sum, activity) => sum + (activity.area_dunams || 0), 0);

  // New calculation for total weight from harvests, assuming 'quantity' represents weight
  const totalWeight = safeHarvests.reduce((sum, harvest) => sum + (harvest.quantity || 0), 0);

  const totalRevenue = safeHarvests.reduce((sum, harvest) => sum + ((harvest.price_per_unit || 0) * (harvest.quantity || 0)), 0);
  const profit = totalRevenue - totalActivityCost;

  return (
    <>
    {/* נייד: פס קומפקטי אחד במקום שלושה כרטיסים גבוהים */}
    <div className="sm:hidden grid grid-cols-3 divide-x divide-x-reverse divide-gray-100 rounded-2xl border border-gray-200 bg-white shadow-sm py-3 text-center">
      <div>
        <div className="text-base font-bold text-red-600 tabular-nums">₪{totalActivityCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        <div className="text-[11px] text-gray-500">הוצאות · {safeActivities.length} פעילויות</div>
      </div>
      <div>
        <div className="text-base font-bold text-gray-900 tabular-nums">{totalWeight.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-xs font-normal text-gray-400">ק"ג</span></div>
        <div className="text-[11px] text-gray-500">₪{totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} · {safeHarvests.length} קטיפים</div>
      </div>
      <div>
        <div className={`text-base font-bold tabular-nums ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>₪{profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        <div className="text-[11px] text-gray-500">רווחיות</div>
      </div>
    </div>

    <div className="hidden sm:grid gap-6 lg:grid-cols-3">
      {/* פעילויות */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">פעילויות</CardTitle>
          <Link 
            to={createPageUrl("Settings?tab=activity_types")}
            className="text-blue-600 hover:text-blue-800"
            title="נהל סוגי פעילויות"
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{safeActivities.length}</div>
          <div className="space-y-1 mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">עלות כוללת:</span>
              <span className="font-medium">₪{totalActivityCost.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">שטח מטופל:</span>
              <span className="font-medium">{totalActivityArea.toFixed(1)} דונם</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* קטיפים */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">קטיפים</CardTitle>
          <Link 
            to={createPageUrl("Settings?tab=varieties")}
            className="text-blue-600 hover:text-blue-800"
            title="נהל זנים"
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{safeHarvests.length}</div>
          <div className="space-y-1 mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">משקל כולל:</span>
              <span className="font-medium">{totalWeight.toLocaleString()} ק"ג</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">הכנסות:</span>
              <span className="font-medium">₪{totalRevenue.toLocaleString()}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* רווחיות */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">רווחיות</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            ₪{profit.toLocaleString()}
          </div>
          <div className="space-y-1 mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">הכנסות:</span>
              <span className="font-medium text-green-600">₪{totalRevenue.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">הוצאות:</span>
              <span className="font-medium text-red-600">₪{totalActivityCost.toLocaleString()}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
    </>
  );
}
