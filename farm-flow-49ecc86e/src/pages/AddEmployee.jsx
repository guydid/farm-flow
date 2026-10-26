import React, { useState, useEffect, useCallback } from 'react';
import { listFarmUsers } from '@/api/farmUsers';
import { useNavigate } from 'react-router-dom';
import { ManpowerCompany, User, Farm } from '@/entities/all';
import EmployeeForm from '../components/employees/EmployeeForm';
import { useToast } from "@/components/ui/use-toast";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

import PageHeader from "@/components/common/PageHeader";
export default function AddEmployee() {
    const [manpowerCompanies, setManpowerCompanies] = useState([]);
    const [users, setUsers] = useState([]);
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
                setIsLoading(false);
                return;
            }

            const farm = await Farm.get(user.current_farm_id);
            setCurrentFarm(farm);

            const farmFilter = { farm_id: user.current_farm_id };
            const [companiesData, usersData] = await Promise.all([
                ManpowerCompany.filter(farmFilter),
                listFarmUsers(farm.id)
            ]);
            
            setManpowerCompanies(Array.isArray(companiesData) ? companiesData : []);
            setUsers(Array.isArray(usersData) ? usersData : []);
        } catch (error) {
            console.error("Failed to load data for new employee form:", error);
            toast({ title: "שגיאה בטעינת נתונים", description: "לא ניתן לטעון את הנתונים הדרושים ליצירת עובד חדש.", variant: "destructive" });
        }
        setIsLoading(false);
    }, [toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleSuccess = () => {
        toast({ title: "הצלחה", description: "העובד נוסף בהצלחה." });
        navigate(createPageUrl("Employees"));
    };
    
    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8" dir="rtl">
            <div className="max-w-4xl mx-auto">
                <PageHeader title="הוספת עובד חדש" backTo={createPageUrl("Employees")} backLabel="חזרה לרשימת העובדים" />

                <Card>
                    <CardContent className="pt-6">
                         <EmployeeForm
                            employee={null}
                            currentFarm={currentFarm}
                            manpowerCompanies={manpowerCompanies}
                            users={users}
                            onClose={() => navigate(createPageUrl("Employees"))}
                            onSuccess={handleSuccess}
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}