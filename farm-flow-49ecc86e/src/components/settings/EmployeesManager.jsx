import React, { useState, useEffect, useCallback } from 'react';
import { Employee, ManpowerCompany, User, Farm } from '@/entities/all';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Download, Upload, FileText, Loader2, AlertTriangle, Edit, Trash2 } from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { UploadFile } from '@/integrations/Core';
import { importEmployees } from '@/functions/importEmployees';

export default function EmployeesManager() {
    const [employees, setEmployees] = useState([]);
    const [manpowerCompanies, setManpowerCompanies] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentFarm, setCurrentFarm] = useState(null);
    
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [importFile, setImportFile] = useState(null);
    const [isExporting, setIsExporting] = useState(false);

    const { toast } = useToast();

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const user = await User.me();
            if (!user.current_farm_id) {
                setIsLoading(false);
                return;
            }

            const farm = await Farm.get(user.current_farm_id);
            setCurrentFarm(farm);

            const farmFilter = { farm_id: user.current_farm_id };
            const [employeesData, companiesData] = await Promise.all([
                Employee.filter(farmFilter, '-start_date').catch(() => []),
                ManpowerCompany.filter(farmFilter).catch(() => [])
            ]);
            
            setEmployees(Array.isArray(employeesData) ? employeesData : []);
            setManpowerCompanies(Array.isArray(companiesData) ? companiesData : []);
        } catch (error) {
            console.error("Failed to load employees data:", error);
            toast({ title: "שגיאה בטעינת נתונים", description: error.message, variant: "destructive" });
        }
        setIsLoading(false);
    }, [toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const getStatusBadge = (status) => {
        const variants = {
            active: "bg-green-100 text-green-800",
            inactive: "bg-red-100 text-red-800",
            on_leave: "bg-yellow-100 text-yellow-800",
            abandoned: "bg-purple-100 text-purple-800",
            inter_visa: "bg-blue-100 text-blue-800",
        };
        const labels = {
            active: "פעיל",
            inactive: "לא פעיל",
            on_leave: "בחופשה",
            abandoned: "נטש",
            inter_visa: "בהליך אשרה",
        };
        return <Badge className={variants[status] || "bg-gray-100 text-gray-800"}>{labels[status] || status}</Badge>;
    };

    const getCompanyName = useCallback((companyId) => {
        if (!companyId) return "-";
        const company = manpowerCompanies.find(c => c && c.id === companyId);
        return company ? company.name : "לא נמצא";
    }, [manpowerCompanies]);

    const getDaysUntilExpiry = (dateString) => {
        if (!dateString) return null;
        try {
            return differenceInDays(parseISO(dateString), new Date());
        } catch {
            return null;
        }
    };

    const getExpiryBadge = (dateString, label) => {
        const days = getDaysUntilExpiry(dateString);
        if (days === null) return null;
        
        if (days < 0) {
            return <Badge variant="destructive" className="text-xs"><AlertTriangle className="w-3 h-3 ml-1" />{label} פג</Badge>;
        }
        if (days <= 30) {
            return <Badge variant="default" className="text-xs animate-pulse"><AlertTriangle className="w-3 h-3 ml-1" />{label} יפוג בעוד {days} ימים</Badge>;
        }
        return null;
    };

    const handleExportCSV = async () => {
        setIsExporting(true);
        try {
            const headers = [
                "שם פרטי", "שם משפחה", "כינוי", "סטטוס", "תאריך תחילת עבודה", 
                "תאריך סיום העסקה", "תאריך כניסה לארץ", "מדינת מוצא", 
                "מספר דרכון", "תוקף דרכון", "סוג אשרה", "תוקף אשרה", "הערות"
            ];
            
            const statusMap = {
                active: "פעיל",
                inactive: "לא פעיל",
                on_leave: "בחופשה",
                abandoned: "נטש",
                inter_visa: "בהליך אשרה",
            };

            const rows = employees.map(emp => [
                emp.first_name || '',
                emp.last_name || '',
                emp.nickname || '',
                statusMap[emp.status] || emp.status || '',
                emp.start_date ? format(parseISO(emp.start_date), 'yyyy-MM-dd') : '',
                emp.termination_date ? format(parseISO(emp.termination_date), 'yyyy-MM-dd') : '',
                emp.entry_date ? format(parseISO(emp.entry_date), 'yyyy-MM-dd') : '',
                emp.country_of_origin || '',
                emp.passport_number || '',
                emp.passport_expiry ? format(parseISO(emp.passport_expiry), 'yyyy-MM-dd') : '',
                emp.visa_type || '',
                emp.visa_expiry ? format(parseISO(emp.visa_expiry), 'yyyy-MM-dd') : '',
                (emp.notes || '').replace(/"/g, '""')
            ]);

            const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
                + [headers.join(','), ...rows.map(row => `"${row.join('","')}"`)].join('\n');

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `employees_export_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toast({ title: "הצלחה", description: "ייצוא העובדים הושלם." });
        } catch (error) {
            toast({ title: "שגיאה", description: "ייצוא נכשל.", variant: "destructive" });
        }
        setIsExporting(false);
    };

    const handleFileSelect = (event) => {
        setImportFile(event.target.files[0]);
    };

    const handleImport = async () => {
        if (!importFile) {
            toast({ title: "שגיאה", description: "יש לבחור קובץ תחילה.", variant: "destructive" });
            return;
        }

        setIsImporting(true);
        try {
            const { file_url } = await UploadFile({ file: importFile });
            
            const { data: result } = await importEmployees({ file_url });

            if (result.success) {
                toast({
                    title: "הייבוא הושלם",
                    description: `${result.imported} עובדים נוספו, ${result.skipped} שורות דולגו.`,
                });
                loadData();
                setIsImportOpen(false);
                setImportFile(null);
            } else {
                throw new Error(result.error || "שגיאה לא ידועה בייבוא");
            }

        } catch (error) {
            console.error("Import failed:", error);
            toast({ title: "שגיאה בייבוא", description: error.message, variant: "destructive" });
        } finally {
            setIsImporting(false);
        }
    };

    const downloadTemplate = () => {
        const headers = [
            "שם פרטי", "שם משפחה", "כינוי", "סטטוס", "תאריך תחילת עבודה", 
            "תאריך סיום העסקה", "תאריך כניסה לארץ", "מדינת מוצא", 
            "מספר דרכון", "תוקף דרכון", "סוג אשרה", "תוקף אשרה", "הערות"
        ];

        const exampleRows = [
            ["יוסי", "כהן", "יוסי", "פעיל", "2024-01-15", "", "2024-01-10", "תאילנד", "AB123456", "2026-01-15", "B1", "2025-06-15", "עובד מצוין"],
            ["מרי", "גונזלס", "", "פעיל", "2024-02-01", "", "2024-01-28", "פיליפינים", "CD789012", "2025-12-01", "B1", "2025-07-01", ""]
        ];

        const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
            + [headers.join(','), ...exampleRows.map(row => `"${row.join('","')}"`)].join('\n');

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "employees_template.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({ title: "הצלחה", description: "קובץ התבנית הורד." });
    };

    if (isLoading) {
        return (
            <Card>
                <CardContent className="flex items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center justify-between">
                    <span>ניהול עובדים</span>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={downloadTemplate}>
                            <FileText className="w-4 h-4 ml-2" />
                            הורד תבנית
                        </Button>
                        <Button variant="outline" onClick={() => setIsImportOpen(true)}>
                            <Upload className="w-4 h-4 ml-2" />
                            ייבא עובדים
                        </Button>
                        <Button variant="outline" onClick={handleExportCSV} disabled={isExporting}>
                            {isExporting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Download className="w-4 h-4 ml-2" />}
                            ייצא עובדים
                        </Button>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                {employees.length === 0 ? (
                    <div className="text-center py-8">
                        <p className="text-gray-500">לא נמצאו עובדים במערכת</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>שם</TableHead>
                                    <TableHead>סטטוס</TableHead>
                                    <TableHead>תאריך התחלה</TableHead>
                                    <TableHead>מדינת מוצא</TableHead>
                                    <TableHead>חברת כח אדם</TableHead>
                                    <TableHead>תוקף דרכון</TableHead>
                                    <TableHead>תוקף ויזה</TableHead>
                                    <TableHead>התראות</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {employees.map(employee => (
                                    <TableRow key={employee.id}>
                                        <TableCell>
                                            <div>
                                                <div className="font-medium">{employee.full_name}</div>
                                                {employee.nickname && <div className="text-sm text-gray-500">{employee.nickname}</div>}
                                            </div>
                                        </TableCell>
                                        <TableCell>{getStatusBadge(employee.status)}</TableCell>
                                        <TableCell>
                                            {employee.start_date ? format(parseISO(employee.start_date), 'dd/MM/yyyy') : '-'}
                                        </TableCell>
                                        <TableCell>{employee.country_of_origin || '-'}</TableCell>
                                        <TableCell>{getCompanyName(employee.manpower_company_id)}</TableCell>
                                        <TableCell>
                                            {employee.passport_expiry ? format(parseISO(employee.passport_expiry), 'dd/MM/yyyy') : '-'}
                                        </TableCell>
                                        <TableCell>
                                            {employee.visa_expiry ? format(parseISO(employee.visa_expiry), 'dd/MM/yyyy') : '-'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="space-y-1">
                                                {getExpiryBadge(employee.passport_expiry, 'דרכון')}
                                                {getExpiryBadge(employee.visa_expiry, 'ויזה')}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>

            {/* Import Dialog */}
            <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
                <DialogContent dir="rtl">
                    <DialogHeader>
                        <DialogTitle>ייבוא עובדים מקובץ CSV</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <h4 className="font-semibold mb-2">הוראות להכנת הקובץ:</h4>
                            <ul className="text-sm space-y-1">
                                <li>• הקובץ צריך להיות בפורמט CSV</li>
                                <li>• השורה הראשונה צריכה לכלול כותרות</li>
                                <li>• תאריכים בפורמט YYYY-MM-DD (למשל: 2024-01-15)</li>
                                <li>• סטטוס: פעיל, לא פעיל, בחופשה, נטש, בהליך אשרה</li>
                                <li>• שדות חובה: שם פרטי, שם משפחה, תאריך תחילת עבודה</li>
                            </ul>
                        </div>
                        
                        <div>
                            <Label htmlFor="csvFile">בחר קובץ CSV</Label>
                            <Input
                                id="csvFile"
                                type="file"
                                accept=".csv"
                                onChange={handleFileSelect}
                                className="mt-1"
                            />
                        </div>
                        
                        {importFile && (
                            <div className="text-sm text-green-600">
                                נבחר קובץ: {importFile.name}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsImportOpen(false)}>
                            ביטול
                        </Button>
                        <Button onClick={handleImport} disabled={!importFile || isImporting}>
                            {isImporting && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                            ייבא עובדים
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}