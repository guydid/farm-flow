
import React, { useEffect, useState } from "react";
import { Seeding, Harvest, Plot, User, Farm, Activity, Spraying } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import SeedingsGanttChart from "../components/dashboard/SeedingsGanttChart";
import HarvestChart from "../components/dashboard/HarvestChart";
import IncomeDistributionChart from "../components/dashboard/IncomeDistributionChart";
import DashboardSummary from "../components/dashboard/DashboardSummary";
import MobileDashboard from "../components/dashboard/MobileDashboard";
import EventsTimelineChart from "../components/dashboard/EventsTimelineChart";
import ErrorBoundary from "../components/ErrorBoundary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

const DashboardSkeleton = () => (
  <div className="space-y-6">
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
    
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-96 w-full" />
      </CardContent>
    </Card>

    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    </div>
  </div>
);

export default function Dashboard() {
  const [seedings, setSeedings] = useState([]);
  const [harvests, setHarvests] = useState([]);
  const [plots, setPlots] = useState([]);
  const [activities, setActivities] = useState([]);
  const [sprayings, setSprayings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [currentFarm, setCurrentFarm] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const user = await User.me();
      if (!user || !user.current_farm_id) {
        // Safe initialization when no farm
        setSeedings([]);
        setHarvests([]);
        setPlots([]);
        setActivities([]);
        setSprayings([]);
        setCurrentFarm(null);
        setIsLoading(false);
        return;
      }
      
      const farm = await Farm.get(user.current_farm_id);
      setCurrentFarm(farm);

      const farmFilter = { farm_id: user.current_farm_id };
      
      // Use Promise.allSettled to handle individual failures gracefully
      const [seedingsResult, harvestsResult, plotsResult, activitiesResult, sprayingsResult] = await Promise.allSettled([
        Seeding.filter(farmFilter, "-start_date").catch(err => {
          console.warn('Failed to load seedings:', err);
          return [];
        }),
        Harvest.filter(farmFilter, "-date").catch(err => {
          console.warn('Failed to load harvests:', err);
          return [];
        }),
        Plot.filter(farmFilter).catch(err => {
          console.warn('Failed to load plots:', err);
          return [];
        }),
        Activity.filter(farmFilter, "-date").catch(err => {
          console.warn('Failed to load activities:', err);
          return [];
        }),
        Spraying.filter(farmFilter, "-date").catch(err => {
          console.warn('Failed to load sprayings:', err);
          return [];
        })
      ]);

      // Safe handling of results with detailed error logging
      const seedingsData = seedingsResult.status === 'fulfilled' && Array.isArray(seedingsResult.value) 
        ? seedingsResult.value : [];
      const harvestsData = harvestsResult.status === 'fulfilled' && Array.isArray(harvestsResult.value) 
        ? harvestsResult.value : [];
      const plotsData = plotsResult.status === 'fulfilled' && Array.isArray(plotsResult.value) 
        ? plotsResult.value : [];
      const activitiesData = activitiesResult.status === 'fulfilled' && Array.isArray(activitiesResult.value) 
        ? activitiesResult.value : [];
      const sprayingsData = sprayingsResult.status === 'fulfilled' && Array.isArray(sprayingsResult.value) 
        ? sprayingsResult.value : [];

      console.log('Dashboard loaded data:', {
        seedings: seedingsData.length,
        harvests: harvestsData.length,
        activities: activitiesData.length,
        sprayings: sprayingsData.length
      });

      setSeedings(seedingsData);
      setHarvests(harvestsData);
      setPlots(plotsData);
      setActivities(activitiesData);
      setSprayings(sprayingsData);
      
      // Log any failed requests for debugging
      if (seedingsResult.status === 'rejected') console.warn('Failed to load seedings:', seedingsResult.reason);
      if (harvestsResult.status === 'rejected') console.warn('Failed to load harvests:', harvestsResult.reason);
      if (plotsResult.status === 'rejected') console.warn('Failed to load plots:', plotsResult.reason);
      if (activitiesResult.status === 'rejected') console.warn('Failed to load activities:', activitiesResult.reason);
      if (sprayingsResult.status === 'rejected') console.warn('Failed to load sprayings:', sprayingsResult.reason);
      
    } catch (error) {
      console.error("Error loading dashboard data:", error);
      setError(`שגיאה בטעינת נתוני הדשבורד: ${error.message || 'שגיאה לא ידועה'}`);
      // Safe initialization on error
      setSeedings([]);
      setHarvests([]);
      setPlots([]);
      setActivities([]);
      setSprayings([]);
    }
    
    setIsLoading(false);
  };

  if (isMobile && !isLoading) {
    return (
      <ErrorBoundary>
        <MobileDashboard />
      </ErrorBoundary>
    );
  }

  // Safe filtering with array checks
  const activeSeedings = Array.isArray(seedings) ? 
    seedings.filter(s => s && s.status && s.status !== 'uprooted' && s.status !== 'archived') : [];

  if (error) {
    return (
      <ErrorBoundary>
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
          <div className="max-w-screen-2xl mx-auto">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>שגיאה בטעינת נתוני הדשבורד</AlertTitle>
              <AlertDescription>
                {error}
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
        <div className="max-w-screen-2xl mx-auto space-y-6">
          <h1 className="text-3xl font-bold text-gray-800">
            סקירה
            {currentFarm && <span className="text-lg text-gray-500 font-normal ml-4"> - {currentFarm.name}</span>}
          </h1>
          
          {isLoading ? (
            <DashboardSkeleton />
          ) : (
            <>
              <ErrorBoundary>
                <DashboardSummary seedings={seedings} plots={plots} harvests={harvests} />
              </ErrorBoundary>
              
              <ErrorBoundary>
                <SeedingsGanttChart 
                  activeSeedings={activeSeedings}
                  activities={activities}
                  harvests={harvests}
                  sprayings={sprayings}
                />
              </ErrorBoundary>

              <ErrorBoundary>
                <EventsTimelineChart
                  seedings={seedings}
                  harvests={harvests}
                  sprayings={sprayings}
                  activities={activities}
                />
              </ErrorBoundary>

              <div className="grid gap-6 lg:grid-cols-2">
                <ErrorBoundary>
                  <HarvestChart harvests={harvests} seedings={seedings} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <IncomeDistributionChart harvests={harvests} seedings={seedings} />
                </ErrorBoundary>
              </div>
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
