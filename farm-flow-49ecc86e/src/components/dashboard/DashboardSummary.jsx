import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sprout, MapPin, Users, TrendingUp, Calendar, Package } from "lucide-react";
import { format, addDays, parseISO } from "date-fns";

export default function DashboardSummary({ seedings, plots, harvests }) {
  // Safe array handling with detailed checks
  const safeSeedings = Array.isArray(seedings) ? seedings : [];
  const safePlots = Array.isArray(plots) ? plots : [];
  const safeHarvests = Array.isArray(harvests) ? harvests : [];

  const activeSeedings = safeSeedings.filter(s => 
    s && s.status && !['uprooted', 'archived'].includes(s.status)
  );
  
  const activePlots = safePlots.filter(p => 
    p && p.activity_status === 'active'
  );

  const totalHarvestWeight = safeHarvests.reduce((sum, h) => {
    const weight = (h && typeof h.weight === 'number') ? h.weight : 0;
    return sum + weight;
  }, 0);

  const totalHarvestRevenue = safeHarvests.reduce((sum, h) => {
    const quantity = (h && typeof h.quantity === 'number') ? h.quantity : 0;
    const price = (h && typeof h.price_per_unit === 'number') ? h.price_per_unit : 0;
    return sum + (quantity * price);
  }, 0);

  // Get upcoming harvests (next 30 days)
  const upcomingHarvests = safeSeedings.filter(s => {
    if (!s || !s.planting_date || !s.days_from_planting_to_harvest) return false;
    
    try {
      const harvestDate = addDays(parseISO(s.planting_date), s.days_from_planting_to_harvest);
      const daysUntil = Math.ceil((harvestDate - new Date()) / (1000 * 60 * 60 * 24));
      return daysUntil <= 30 && daysUntil >= 0;
    } catch (error) {
      console.warn('Error calculating harvest date for seeding:', s.id, error);
      return false;
    }
  }).length;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">מזרעים פעילים</CardTitle>
          <Sprout className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{activeSeedings.length}</div>
          <p className="text-xs text-muted-foreground">
            {safeSeedings.length > 0 ? `מתוך ${safeSeedings.length} סה"כ` : "אין מזרעים"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">חלקות פעילות</CardTitle>
          <MapPin className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{activePlots.length}</div>
          <p className="text-xs text-muted-foreground">
            {safePlots.length > 0 ? `מתוך ${safePlots.length} סה"כ` : "אין חלקות"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">סה"כ קטיף</CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {totalHarvestWeight > 0 ? `${totalHarvestWeight.toLocaleString()} ק"ג` : "0"}
          </div>
          <p className="text-xs text-muted-foreground">
            הכנסות: ₪{totalHarvestRevenue.toLocaleString()}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">קטיפים קרובים</CardTitle>
          <Calendar className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{upcomingHarvests}</div>
          <p className="text-xs text-muted-foreground">
            ב-30 הימים הקרובים
          </p>
        </CardContent>
      </Card>
    </div>
  );
}