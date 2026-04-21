import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Vehicle, User, Farm } from '@/entities/all';
import VehicleForm from '../components/vehicles/VehicleForm';
import { useToast } from "@/components/ui/use-toast";
import { createPageUrl } from '@/utils';
import { ArrowRight, Loader2 } from 'lucide-react';

export default function EditVehicle() {
    const [currentFarm, setCurrentFarm] = useState(null);
    const [vehicle, setVehicle] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const navigate = useNavigate();
    const location = useLocation();
    const { toast } = useToast();

    const vehicleId = useMemo(() => new URLSearchParams(location.search).get('id'), [location.search]);

    const loadData = useCallback(async () => {
        if (!vehicleId) {
            toast({ title: "שגיאה", description: "לא סופק מזהה רכב.", variant: "destructive" });
            navigate(createPageUrl("Vehicles"));
            return;
        }
        setIsLoading(true);
        try {
            const user = await User.me();
            if (!user.current_farm_id) {
                toast({ title: "שגיאה", description: "לא נבחר משק פעיל.", variant: "destructive" });
                navigate(createPageUrl("Dashboard"));
                return;
            }
            const [farm, vehicleData] = await Promise.all([
                Farm.get(user.current_farm_id),
                Vehicle.get(vehicleId)
            ]);
            setCurrentFarm(farm);
            setVehicle(vehicleData);
        } catch (error) {
            toast({ title: "שגיאה בטעינת נתונים", variant: "destructive" });
            navigate(createPageUrl("Vehicles"));
        }
        setIsLoading(false);
    }, [toast, navigate, vehicleId]);

    useEffect(() => { loadData(); }, [loadData]);

    const handleSuccess = () => {
        navigate(createPageUrl(`VehicleDetail?id=${vehicleId}`));
    };
    
    if (isLoading) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8" dir="rtl">
            <div className="max-w-4xl mx-auto">
                <div className="mb-6">
                    <Link to={createPageUrl(`VehicleDetail?id=${vehicleId}`)} className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"><ArrowRight className="h-4 w-4" />חזרה לפרטי הרכב</Link>
                    <h1 className="text-3xl font-bold text-gray-900">עריכת רכב: {vehicle?.name}</h1>
                </div>
                <VehicleForm
                    vehicle={vehicle}
                    currentFarm={currentFarm}
                    onSuccess={handleSuccess}
                    onCancel={() => navigate(createPageUrl(`VehicleDetail?id=${vehicleId}`))}
                />
            </div>
        </div>
    );
}