import React, { useState, useEffect } from "react";
import { User, Farm } from "@/entities/all";
import { useToast } from "@/components/ui/use-toast";
import SubscriptionManager from "../components/subscription/SubscriptionManager";

export default function Subscription() {
  const [currentFarm, setCurrentFarm] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadCurrentFarm();
  }, []);

  const loadCurrentFarm = async () => {
    setIsLoading(true);
    try {
      const user = await User.me();
      if (user.current_farm_id) {
        const farm = await Farm.get(user.current_farm_id);
        setCurrentFarm(farm);
      }
    } catch (error) {
      console.error("Error loading farm:", error);
      toast({ title: "שגיאה", description: "טעינת פרטי המשק נכשלה", variant: "destructive" });
    }
    setIsLoading(false);
  };

  if (isLoading) {
    return <div className="flex justify-center items-center h-screen">טוען...</div>;
  }

  if (!currentFarm) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-bold mb-4">אין משק פעיל</h2>
        <p>יש לבחור משק כדי לנהל את המנוי.</p>
      </div>
    );
  }

  return (
    <div className="p-6" dir="rtl">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">ניהול מנוי</h1>
          <p className="text-gray-600">ניהול מנוי ותשלומים עבור המשק</p>
        </div>
        
        <SubscriptionManager currentFarm={currentFarm} />
      </div>
    </div>
  );
}