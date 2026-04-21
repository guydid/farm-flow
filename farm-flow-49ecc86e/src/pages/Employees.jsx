
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Employee, ManpowerCompany, User, Farm } from '@/entities/all';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectValue, SelectTrigger } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, User as UserIcon, Filter, Search, Printer, AlertTriangle, X, Copy, Check, SlidersHorizontal, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { format, parseISO, differenceInDays } from 'date-fns';
import { useToast } from "@/components/ui/use-toast";

export default function Employees() {
    const [employees, setEmployees] = useState([]);
    const [manpowerCompanies, setManpowerCompanies] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentFarm, setCurrentFarm] = useState(null);
    const [filterStatus, setFilterStatus] = useState("all");
    const [filterCompany, setFilterCompany] = useState("all"); // New filter for company
    const [searchText, setSearchText] = useState("");
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [users, setUsers] = useState([]);
    const [copiedField, setCopiedField] = useState(null);
    const { toast } = useToast();

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const user = await User.me();
            if (!user.current_farm_id) {
                console.warn("No current farm ID found for the user.");
                setIsLoading(false);
                setEmployees([]);
                setManpowerCompanies([]);
                setCurrentFarm(null);
                setUsers([]);
                return;
            }

            const farm = await Farm.get(user.current_farm_id);
            setCurrentFarm(farm);

            const farmFilter = { farm_id: user.current_farm_id };
            // Fetch employees sorted by start_date ascending (oldest first)
            const [employeesData, companiesData, usersData] = await Promise.all([
                Employee.filter(farmFilter, 'start_date').catch(() => []),
                ManpowerCompany.filter(farmFilter).catch(() => []),
                User.list().catch(() => [])
            ]);

            setEmployees(Array.isArray(employeesData) ? employeesData : []);
            setManpowerCompanies(Array.isArray(companiesData) ? companiesData : []);
            setUsers(Array.isArray(usersData) ? usersData : []);
        } catch (error) {
            console.error("Failed to load employees or farm data:", error);
            setEmployees([]);
            setManpowerCompanies([]);
            setCurrentFarm(null);
            setUsers([]);
            toast({ title: "שגיאה בטעינת נתונים", description: error.message || "אירעה שגיאה בעת טעינת הנתונים.", variant: "destructive" });
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

    const getDaysUntilExpiry = (dateString) => {
        if (!dateString) return null;
        try {
            return differenceInDays(parseISO(dateString), new Date());
        } catch {
            return null;
        }
    };

    const getExpiryWarning = (dateString, label) => {
        const days = getDaysUntilExpiry(dateString);
        if (days === null) return null;

        if (days < 0) return <Badge variant="destructive" className="text-xs"><AlertTriangle className="w-3 h-3 ml-1" />{label} פג</Badge>;
        if (days <= 30) return <Badge variant="default" className="text-xs animate-pulse"><AlertTriangle className="w-3 h-3 ml-1" />{label} יפוג בעוד {days} ימים</Badge>;
        return null;
    };

    const getInitials = (firstName, lastName) => {
        const first = firstName?.charAt(0) || "";
        const last = lastName?.charAt(0) || "";
        return (first + last).toUpperCase() || "?";
    };

    const getCompanyName = useCallback((companyId) => {
        if (!companyId) return "-";
        const safeCompanies = Array.isArray(manpowerCompanies) ? manpowerCompanies : [];
        const company = safeCompanies.find(c => c && c.id === companyId);
        return company ? company.name : "חברה לא נמצאה";
    }, [manpowerCompanies]);

    const filteredEmployees = useMemo(() => {
        const safeEmployees = Array.isArray(employees) ? employees : [];
        return safeEmployees.filter(emp => {
            if (!emp) return false;

            // Status filter
            const statusMatch = filterStatus === "all" || emp.status === filterStatus;

            // Company filter (NEW)
            const companyMatch = filterCompany === "all" ||
                                 (filterCompany === "null" && !emp.manpower_company_id) || // If 'No company' is selected
                                 (filterCompany !== "null" && emp.manpower_company_id === filterCompany); // If specific company ID is selected

            // Enhanced search filter
            const searchMatch = searchText === "" ||
                (emp.full_name && emp.full_name.toLowerCase().includes(searchText.toLowerCase())) ||
                (emp.nickname && emp.nickname.toLowerCase().includes(searchText.toLowerCase())) ||
                (emp.country_of_origin && emp.country_of_origin.toLowerCase().includes(searchText.toLowerCase())) ||
                (emp.passport_number && emp.passport_number.toLowerCase().includes(searchText.toLowerCase())) ||
                (emp.insurance_details?.health_fund_number && emp.insurance_details.health_fund_number.toLowerCase().includes(searchText.toLowerCase()));

            return statusMatch && companyMatch && searchMatch;
        });
    }, [employees, filterStatus, filterCompany, searchText]);

    // Count employees per status (from full list, not filtered)
    const statusCounts = useMemo(() => {
        const safe = Array.isArray(employees) ? employees : [];
        return safe.reduce((acc, e) => {
            const s = e?.status || 'active';
            acc[s] = (acc[s] || 0) + 1;
            return acc;
        }, {});
    }, [employees]);

    const STATUS_CONFIG = [
        { key: 'all',        label: 'הכל',         dot: 'bg-gray-400',   active: 'bg-gray-900 text-white border-gray-900',   passive: 'bg-white border-gray-200 text-gray-700 hover:border-gray-400' },
        { key: 'active',     label: 'פעיל',         dot: 'bg-green-500',  active: 'bg-green-600 text-white border-green-600',  passive: 'bg-white border-gray-200 text-gray-700 hover:border-green-400' },
        { key: 'inactive',   label: 'לא פעיל',      dot: 'bg-red-500',    active: 'bg-red-600 text-white border-red-600',      passive: 'bg-white border-gray-200 text-gray-700 hover:border-red-400' },
        { key: 'on_leave',   label: 'בחופשה',       dot: 'bg-yellow-500', active: 'bg-yellow-500 text-white border-yellow-500', passive: 'bg-white border-gray-200 text-gray-700 hover:border-yellow-400' },
        { key: 'abandoned',  label: 'נטש',          dot: 'bg-purple-500', active: 'bg-purple-600 text-white border-purple-600', passive: 'bg-white border-gray-200 text-gray-700 hover:border-purple-400' },
        { key: 'inter_visa', label: 'אינטרוויזה',   dot: 'bg-blue-500',   active: 'bg-blue-600 text-white border-blue-600',    passive: 'bg-white border-gray-200 text-gray-700 hover:border-blue-400' },
    ];

    const copyToClipboard = async (text, fieldName) => {
        if (!text) {
            toast({ title: "שגיאה", description: "אין מידע להעתקה", variant: "destructive" });
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(fieldName);
            toast({ title: "הועתק", description: `${fieldName} הועתק ללוח` });

            // Reset copied state after 2 seconds
            setTimeout(() => setCopiedField(null), 2000);
        } catch (error) {
            console.error("Failed to copy:", error);
            toast({ title: "שגיאה", description: "לא ניתן להעתיק", variant: "destructive" });
        }
    };

    const clearFilters = () => {
        setFilterStatus("all");
        setFilterCompany("all"); // Reset new filter
        setSearchText("");
    };

    const handlePrintReport = () => {
        const printWindow = window.open('', '_blank');
        const currentDate = new Date().toLocaleDateString('he-IL');

        const statusLabels = {
            active: "פעיל",
            inactive: "לא פעיל",
            on_leave: "בחופשה",
            abandoned: "נטש",
            inter_visa: "בהליך אשרה",
        };

        const printContent = `
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="utf-8">
            <title>דוח עובדים - ${currentFarm?.name || 'המשק'}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; direction: rtl; }
                .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
                .farm-name { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
                .report-title { font-size: 20px; color: #666; margin-bottom: 5px; }
                .date { font-size: 14px; color: #888; }
                .summary { margin-bottom: 30px; background: #f5f5f5; padding: 15px; border-radius: 5px; }
                .summary-title { font-size: 16px; font-weight: bold; margin-bottom: 10px; }
                .summary-stats { display: flex; justify-content: space-around; }
                .stat { text-align: center; }
                .stat-number { font-size: 24px; font-weight: bold; color: #2563eb; }
                .stat-label { font-size: 12px; color: #666; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: right; }
                th { background-color: #f8f9fa; font-weight: bold; }
                .status-active { color: #16a34a; font-weight: bold; }
                .status-inactive { color: #dc2626; font-weight: bold; }
                .status-on_leave { color: #ea580c; font-weight: bold; }
                .status-abandoned { color: #9333ea; font-weight: bold; }
                .status-inter_visa { color: #2563eb; font-weight: bold; }
                .warning { color: #dc2626; font-weight: bold; }
                .footer { margin-top: 30px; font-size: 12px; color: #666; text-align: center; border-top: 1px solid #ddd; padding-top: 10px; }
                @media print { body { margin: 0; } }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="farm-name">${currentFarm?.name || 'המשק'}</div>
                <div class="report-title">דוח עובדים</div>
                <div class="date">נכון ל- ${currentDate}</div>
            </div>

            <div class="summary">
                <div class="summary-title">סיכום</div>
                <div class="summary-stats">
                    <div class="stat">
                        <div class="stat-number">${filteredEmployees.length}</div>
                        <div class="stat-label">סה"כ עובדים</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${filteredEmployees.filter(e => e.status === 'active').length}</div>
                        <div class="stat-label">עובדים פעילים</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${filteredEmployees.filter(e => getDaysUntilExpiry(e.visa_expiry) !== null && getDaysUntilExpiry(e.visa_expiry) <= 30).length}</div>
                        <div class="stat-label">ויזות פגות תוקף</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${filteredEmployees.filter(e => getDaysUntilExpiry(e.passport_expiry) !== null && getDaysUntilExpiry(e.passport_expiry) <= 30).length}</div>
                        <div class="stat-label">דרכונים פגי תוקף</div>
                    </div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>שם מלא</th>
                        <th>כינוי</th>
                        <th>סטטוס</th>
                        <th>תאריך התחלה</th>
                        <th>מדינת מוצא</th>
                        <th>תוקף דרכון</th>
                        <th>תוקף ויזה</th>
                        <th>חברת כח אדם</th>
                        <th>התראות</th>
                    </tr>
                </thead>
                <tbody>
                    ${filteredEmployees.map(employee => {
                        const passportDays = getDaysUntilExpiry(employee.passport_expiry);
                        const visaDays = getDaysUntilExpiry(employee.visa_expiry);
                        const warnings = [];

                        if (passportDays !== null && passportDays <= 30) {
                            warnings.push(passportDays < 0 ? 'דרכון פג' : `דרכון יפוג בעוד ${passportDays} ימים`);
                        }
                        if (visaDays !== null && visaDays <= 30) {
                            warnings.push(visaDays < 0 ? 'ויזה פגה' : `ויזה תפוג בעוד ${visaDays} ימים`);
                        }

                        return `
                            <tr>
                                <td>${employee.full_name || ''}</td>
                                <td>${employee.nickname || ''}</td>
                                <td class="status-${employee.status}">${statusLabels[employee.status] || employee.status}</td>
                                <td>${employee.start_date ? format(parseISO(employee.start_date), 'dd/MM/yyyy') : ''}</td>
                                <td>${employee.country_of_origin || ''}</td>
                                <td>${employee.passport_expiry ? format(parseISO(employee.passport_expiry), 'dd/MM/yyyy') : ''}</td>
                                <td>${employee.visa_expiry ? format(parseISO(employee.visa_expiry), 'dd/MM/yyyy') : ''}</td>
                                <td>${getCompanyName(employee.manpower_company_id)}</td>
                                <td class="warning">${warnings.join(', ')}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>

            <div class="footer">
                דוח זה הופק ב- ${new Date().toLocaleString('he-IL')} | מערכת ניהול משק
            </div>
        </body>
        </html>
        `;

        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.focus();

        setTimeout(() => {
            printWindow.print();
        }, 250);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-2 text-gray-600">טוען עובדים...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-3 sm:p-6 lg:p-8 bg-gray-50/50 min-h-screen" dir="rtl">
            <div className="max-w-screen-2xl mx-auto">
                <div className="flex justify-between items-center gap-2 mb-4 lg:mb-6">
                    <div>
                        <h1 className="text-xl lg:text-3xl font-bold text-gray-900">עובדים</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {filteredEmployees.length} מתוך {employees.length} עובדים
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            onClick={handlePrintReport}
                            variant="outline"
                            size="sm"
                            className="flex items-center gap-1.5"
                        >
                            <Printer className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">הדפס דוח</span>
                        </Button>
                        <Link to={createPageUrl("AddEmployee")}>
                            <Button size="sm" className="flex items-center gap-1.5">
                                <Plus className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">הוסף עובד</span>
                            </Button>
                        </Link>
                    </div>
                </div>

                {/* ── Status bar ── */}
                {employees.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1 mb-4 scrollbar-hide -mx-1 px-1">
                        {STATUS_CONFIG.map(({ key, label, dot, active, passive }) => {
                            const count = key === 'all' ? employees.length : (statusCounts[key] || 0);
                            if (key !== 'all' && count === 0) return null;
                            const isActive = filterStatus === key;
                            return (
                                <button
                                    key={key}
                                    onClick={() => setFilterStatus(key)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${isActive ? active : passive}`}
                                >
                                    {key === 'all'
                                        ? <Users className="w-3.5 h-3.5 flex-shrink-0" />
                                        : <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-white' : dot}`} />
                                    }
                                    <span>{label}</span>
                                    <span className={`text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[22px] text-center ${isActive ? 'bg-white/20' : 'bg-gray-100 text-gray-600'}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Mobile filters toggle */}
                <div className="sm:hidden mb-4">
                    <button
                        onClick={() => setFiltersOpen(o => !o)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-gray-100 border border-gray-200 text-sm font-medium text-gray-700"
                    >
                        <div className="flex items-center gap-2">
                            <SlidersHorizontal className="w-4 h-4 text-gray-500" />
                            <span>
                                סינון
                                {filterStatus !== 'all' && <span className="mr-1 text-blue-600">· {filterStatus === 'active' ? 'פעילים' : filterStatus === 'inactive' ? 'לא פעילים' : filterStatus === 'on_leave' ? 'בחופשה' : filterStatus === 'abandoned' ? 'נוטשים' : 'בהליך אשרה'}</span>}
                                {filterCompany !== 'all' && <span className="mr-1 text-blue-600">· חברה</span>}
                                {searchText && <span className="mr-1 text-blue-600">· "{searchText}"</span>}
                            </span>
                        </div>
                        {filtersOpen ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                    </button>
                    {filtersOpen && (
                        <div className="mt-2 p-3 rounded-xl bg-white border border-gray-200 space-y-3">
                            <div className="relative">
                                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <Input
                                    placeholder="חפש לפי שם, כינוי, מדינה..."
                                    value={searchText}
                                    onChange={(e) => setSearchText(e.target.value)}
                                    className="pr-10"
                                />
                            </div>
                            <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setFiltersOpen(false); }}>
                                <SelectTrigger><SelectValue placeholder="סטטוס" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">כל העובדים</SelectItem>
                                    <SelectItem value="active">פעילים</SelectItem>
                                    <SelectItem value="inactive">לא פעילים</SelectItem>
                                    <SelectItem value="on_leave">בחופשה</SelectItem>
                                    <SelectItem value="abandoned">נוטשים</SelectItem>
                                    <SelectItem value="inter_visa">בהליך אשרה</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={filterCompany} onValueChange={(v) => { setFilterCompany(v); setFiltersOpen(false); }}>
                                <SelectTrigger><SelectValue placeholder="חברת כח אדם" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">כל החברות</SelectItem>
                                    <SelectItem value="null">ללא חברה</SelectItem>
                                    {manpowerCompanies.map(company => (
                                        <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {(searchText || filterStatus !== 'all' || filterCompany !== 'all') && (
                                <Button variant="outline" onClick={() => { clearFilters(); setFiltersOpen(false); }} className="w-full flex items-center justify-center gap-1 text-sm">
                                    <X className="w-4 h-4" />
                                    נקה סינון
                                </Button>
                            )}
                        </div>
                    )}
                </div>

                {/* Desktop Filters Section */}
                <Card className="mb-6 hidden sm:block">
                    <CardContent className="p-4">
                        <div className="flex flex-row gap-4 items-end">
                            <div className="flex-1 space-y-2">
                                <label className="text-sm font-medium text-gray-700">חיפוש</label>
                                <div className="relative">
                                    <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                                    <Input
                                        placeholder="חפש לפי שם, כינוי, מדינה, מספר דרכון או קופת חולים..."
                                        value={searchText}
                                        onChange={(e) => setSearchText(e.target.value)}
                                        className="pr-10"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">סטטוס</label>
                                <div className="flex items-center gap-2">
                                    <Filter className="w-4 h-4 text-gray-500" />
                                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                                        <SelectTrigger className="w-40">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">כל העובדים</SelectItem>
                                            <SelectItem value="active">פעילים</SelectItem>
                                            <SelectItem value="inactive">לא פעילים</SelectItem>
                                            <SelectItem value="on_leave">בחופשה</SelectItem>
                                            <SelectItem value="abandoned">נוטשים</SelectItem>
                                            <SelectItem value="inter_visa">בהליך אשרה</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">חברת כח אדם</label>
                                <div className="flex items-center gap-2">
                                    <Filter className="w-4 h-4 text-gray-500" />
                                    <Select value={filterCompany} onValueChange={setFilterCompany}>
                                        <SelectTrigger className="w-48">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">כל החברות</SelectItem>
                                            <SelectItem value="null">ללא חברה</SelectItem>
                                            {manpowerCompanies.map(company => (
                                                <SelectItem key={company.id} value={company.id}>
                                                    {company.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {(searchText || filterStatus !== "all" || filterCompany !== "all") && (
                                <Button
                                    variant="outline"
                                    onClick={clearFilters}
                                    className="flex items-center gap-1 text-sm"
                                >
                                    <X className="w-4 h-4" />
                                    נקה סינון
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {filteredEmployees.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center py-12">
                            <UserIcon className="w-12 h-12 text-gray-400 mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">לא נמצאו עובדים</h3>
                            <p className="text-gray-500 mb-6">
                                {searchText || filterStatus !== "all" || filterCompany !== "all"
                                    ? "אין עובדים שמתאימים לחיפוש או לסינון שנבחר"
                                    : "טרם נרשמו עובדים במערכת"
                                }
                            </p>
                            {(searchText || filterStatus !== "all" || filterCompany !== "all") && (
                                <Button variant="outline" onClick={clearFilters}>
                                    נקה סינון
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredEmployees.map(employee => employee && (
                           <div key={employee.id} className="h-full">
                               <Card className="hover:shadow-lg transition-all duration-200 h-full flex flex-col">
                                   <CardHeader className="flex flex-row items-center gap-4">
                                       <Avatar className="h-12 w-12">
                                           <AvatarImage src={employee.photo_url} alt={employee.full_name} />
                                           <AvatarFallback>{getInitials(employee.first_name, employee.last_name)}</AvatarFallback>
                                       </Avatar>
                                       <div className="flex-1">
                                           <Link to={createPageUrl(`EmployeeDetail?id=${employee.id}`)}>
                                               <CardTitle className="text-lg hover:text-blue-600 cursor-pointer">{employee.full_name}</CardTitle>
                                           </Link>
                                           {employee.nickname && <p className="text-sm text-muted-foreground">{employee.nickname}</p>}
                                       </div>
                                   </CardHeader>
                                   <CardContent className="flex-grow space-y-3">
                                       <div className="flex items-center justify-between">
                                           {getStatusBadge(employee.status)}
                                       </div>

                                       <div className="text-sm text-muted-foreground space-y-1">
                                           <p>תחילת עבודה: {employee.start_date ? format(parseISO(employee.start_date), 'dd/MM/yyyy') : '-'}</p>
                                           <p>חברת כ"א:
                                               <span className="font-medium text-blue-600 mr-1">
                                                   {getCompanyName(employee.manpower_company_id) || "לא משויך"}
                                               </span>
                                           </p>
                                           <p>מדינה: {employee.country_of_origin || '-'}</p>
                                       </div>

                                       {/* Quick copy buttons */}
                                       <div className="space-y-2 pt-2 border-t">
                                           {employee.full_name && (
                                               <div className="flex items-center justify-between text-xs">
                                                   <span className="text-gray-600">שם מלא:</span>
                                                   <Button
                                                       variant="ghost"
                                                       size="sm"
                                                       className="h-6 px-2"
                                                       onClick={(e) => { e.stopPropagation(); copyToClipboard(employee.full_name, 'שם מלא'); }}
                                                   >
                                                       {copiedField === 'שם מלא' ?
                                                           <Check className="w-3 h-3 text-green-600" /> :
                                                           <Copy className="w-3 h-3" />
                                                       }
                                                       <span className="mr-1 truncate max-w-[80px]">{employee.full_name}</span>
                                                   </Button>
                                               </div>
                                           )}

                                           {employee.passport_number && (
                                               <div className="flex items-center justify-between text-xs">
                                                   <span className="text-gray-600">דרכון:</span>
                                                   <Button
                                                       variant="ghost"
                                                       size="sm"
                                                       className="h-6 px-2"
                                                       onClick={(e) => { e.stopPropagation(); copyToClipboard(employee.passport_number, 'מספר דרכון'); }}
                                                   >
                                                       {copiedField === 'מספר דרכון' ?
                                                           <Check className="w-3 h-3 text-green-600" /> :
                                                           <Copy className="w-3 h-3" />
                                                       }
                                                       <span className="mr-1">{employee.passport_number}</span>
                                                   </Button>
                                               </div>
                                           )}

                                           {employee.insurance_details?.health_fund_number && (
                                               <div className="flex items-center justify-between text-xs">
                                                   <span className="text-gray-600">קופ"ח:</span>
                                                   <Button
                                                       variant="ghost"
                                                       size="sm"
                                                       className="h-6 px-2"
                                                       onClick={(e) => { e.stopPropagation(); copyToClipboard(employee.insurance_details.health_fund_number, 'מספר קופת חולים'); }}
                                                   >
                                                       {copiedField === 'מספר קופת חולים' ?
                                                           <Check className="w-3 h-3 text-green-600" /> :
                                                           <Copy className="w-3 h-3" />
                                                       }
                                                       <span className="mr-1">{employee.insurance_details.health_fund_number}</span>
                                                   </Button>
                                               </div>
                                           )}
                                       </div>

                                       {/* Expiry warnings */}
                                       <div className="space-y-1 pt-2">
                                           {getExpiryWarning(employee.visa_expiry, 'ויזה')}
                                           {getExpiryWarning(employee.passport_expiry, 'דרכון')}
                                       </div>
                                   </CardContent>
                               </Card>
                           </div>
                        ))}
                    </div>
                )}

            </div>
        </div>
    );
}
