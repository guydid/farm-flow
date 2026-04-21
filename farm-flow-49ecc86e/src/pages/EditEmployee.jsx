
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Employee, ManpowerCompany, User, Farm } from '@/entities/all';
import EmployeeForm from '../components/employees/EmployeeForm';
import { useToast } from "@/components/ui/use-toast";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function EditEmployee() {
    const [employee, setEmployee] = useState(null);
    const [manpowerCompanies, setManpowerCompanies] = useState([]);
    const [users, setUsers] = useState([]);
    const [currentFarm, setCurrentFarm] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const navigate = useNavigate();
    const location = useLocation();
    const { toast } = useToast();

    const employeeId = useMemo(() => {
        const params = new URLSearchParams(location.search);
        return params.get('id');
    }, [location.search]);

    const loadData = useCallback(async () => {
        if (!employeeId) {
            toast({ title: "שגיאה", description: "לא צוין מזהה עובד.", variant: "destructive" });
            navigate(createPageUrl("Employees"));
            return;
        }
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
            const [employeeData, companiesData, usersData] = await Promise.all([
                Employee.get(employeeId),
                ManpowerCompany.filter(farmFilter),
                User.list()
            ]);
            
            setEmployee(employeeData);
            setManpowerCompanies(Array.isArray(companiesData) ? companiesData : []);
            setUsers(Array.isArray(usersData) ? usersData : []);
        } catch (error) {
            console.error("Failed to load data for edit employee form:", error);
            toast({ title: "שגיאה בטעינת נתונים", description: "לא ניתן לטעון את הנתונים הדרושים לעריכת העובד.", variant: "destructive" });
        }
        setIsLoading(false);
    }, [employeeId, toast, navigate]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleSuccess = () => {
        toast({ title: "הצלחה", description: "פרטי העובד עודכנו." });
        navigate(createPageUrl(`EmployeeDetail?id=${employeeId}`));
    };
    
    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    if (!employee) {
        return (
             <div className="p-4 sm:p-6 lg:p-8 text-center" dir="rtl">
                <p>העובד לא נמצא.</p>
                 <Link to={createPageUrl("Employees")}>
                    <Button variant="link">חזור לרשימת העובדים</Button>
                </Link>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8" dir="rtl">
            <div className="max-w-4xl mx-auto">
                <div className="mb-6">
                    <Link to={createPageUrl(`EmployeeDetail?id=${employeeId}`)} className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4">
                        <ArrowRight className="h-4 w-4" />
                        חזרה לפרטי העובד
                    </Link>
                    <h1 className="text-3xl font-bold text-gray-900">עריכת עובד: {employee.full_name}</h1>
                </div>

                <Card>
                    <CardContent className="pt-6">
                         <EmployeeForm
                            employee={employee}
                            currentFarm={currentFarm}
                            manpowerCompanies={manpowerCompanies}
                            users={users}
                            onClose={() => navigate(createPageUrl(`EmployeeDetail?id=${employeeId}`))}
                            onSuccess={handleSuccess}
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
