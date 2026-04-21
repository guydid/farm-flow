import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Farm } from '@/entities/all';
import VehicleForm from '../components/vehicles/VehicleForm';
import { useToast } from "@/components/ui/use-toast";
import { createPageUrl } from '@/utils';
import { ArrowRight, Loader2 } from 'lucide-react';

export default function AddVehicle() {
    const [currentFarm, setCurrentFarm] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const navigate = useNavigate();
    const { toast } = useToast();

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const user = await User.me();
            if (!user.current_farm_id) {
                toast({ title: "שגיאה", description: "לא נבחר משק פעיל.", variant: "destructive" });
                navigate(createPageUrl("Dashboard"));
                return;
            }
            const farm = await Farm.get(user.current_farm_id);
            setCurrentFarm(farm);
        } catch (error) {
            toast({ title: "שגיאה בטעינת נתונים", variant: "destructive" });
        }
        setIsLoading(false);
    }, [toast, navigate]);

    useEffect(() => { loadData(); }, [loadData]);

    const handleSuccess = () => {
        navigate(createPageUrl("Vehicles"));
    };
    
    if (isLoading) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8" dir="rtl">
            <div className="max-w-4xl mx-auto">
                <div className="mb-6">
                    <Link to={createPageUrl("Vehicles")} className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"><ArrowRight className="h-4 w-4" />חזרה לרשימת הרכבים</Link>
                    <h1 className="text-3xl font-bold text-gray-900">הוספת רכב חדש</h1>
                </div>
                <VehicleForm
                    currentFarm={currentFarm}
                    onSuccess={handleSuccess}
                    onCancel={() => navigate(createPageUrl("Vehicles"))}
                />
            </div>
        </div>
    );
}