import React, { useState, useEffect } from "react";
import { Subscription, Payment, User, Farm } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { CreditCard, Calendar, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { format, addYears, isAfter, isBefore, differenceInDays } from "date-fns";

export default function SubscriptionManager({ currentFarm }) {
  const [subscription, setSubscription] = useState(null);
  const [payments, setPayments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const { toast } = useToast();

  const plans = {
    basic: {
      name: "בסיסי",
      price: 1200,
      max_plots: 5,
      max_employees: 10,
      max_seedings: 20,
      features: ["מעקב חלקות", "ניהול עובדים", "מעקב מזרעים", "דוחות בסיסיים"]
    },
    premium: {
      name: "מתקדם", 
      price: 2400,
      max_plots: 20,
      max_employees: 50,
      max_seedings: 100,
      features: ["כל התכונות הבסיסיות", "מעקב יריעות", "ניהול הדברה", "דוחות מתקדמים", "תעודות שקילה"]
    },
    enterprise: {
      name: "ארגוני",
      price: 4800,
      max_plots: -1, // ללא הגבלה
      max_employees: -1,
      max_seedings: -1,
      features: ["כל התכונות", "ללא הגבלות", "תמיכה מועדפת", "התאמות אישיות"]
    }
  };

  useEffect(() => {
    if (currentFarm) {
      loadSubscription();
    }
  }, [currentFarm]);

  const loadSubscription = async () => {
    setIsLoading(true);
    try {
      const subscriptions = await Subscription.filter({ farm_id: currentFarm.id });
      if (subscriptions.length > 0) {
        setSubscription(subscriptions[0]);
        const paymentHistory = await Payment.filter({ subscription_id: subscriptions[0].id }, "-payment_date");
        setPayments(paymentHistory);
      }
    } catch (error) {
      console.error("Error loading subscription:", error);
      toast({ title: "שגיאה", description: "טעינת פרטי המנוי נכשלה", variant: "destructive" });
    }
    setIsLoading(false);
  };

  const getStatusBadge = (status) => {
    const variants = {
      active: { variant: "default", label: "פעיל", icon: CheckCircle },
      trial: { variant: "secondary", label: "תקופת ניסיון", icon: Clock },
      expired: { variant: "destructive", label: "פג תוקף", icon: AlertTriangle },
      cancelled: { variant: "outline", label: "מבוטל", icon: AlertTriangle },
      pending_payment: { variant: "secondary", label: "ממתין לתשלום", icon: Clock }
    };
    
    const config = variants[status] || variants.active;
    const Icon = config.icon;
    
    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    );
  };

  const getDaysUntilExpiry = () => {
    if (!subscription?.end_date) return null;
    return differenceInDays(new Date(subscription.end_date), new Date());
  };

  const handleUpgrade = async (newPlanType) => {
    try {
      const newPlan = plans[newPlanType];
      const today = new Date();
      const endDate = addYears(today, 1);

      const updatedSubscription = {
        plan_type: newPlanType,
        plan_name: newPlan.name,
        annual_price: newPlan.price,
        max_plots: newPlan.max_plots,
        max_employees: newPlan.max_employees,
        max_seedings: newPlan.max_seedings,
        features: newPlan.features,
        start_date: format(today, 'yyyy-MM-dd'),
        end_date: format(endDate, 'yyyy-MM-dd'),
        next_payment_date: format(endDate, 'yyyy-MM-dd'),
        status: 'pending_payment'
      };

      if (subscription) {
        await Subscription.update(subscription.id, updatedSubscription);
      } else {
        await Subscription.create({
          ...updatedSubscription,
          farm_id: currentFarm.id
        });
      }

      toast({ title: "הצלחה", description: "המנוי עודכן בהצלחה" });
      setIsUpgradeDialogOpen(false);
      loadSubscription();
    } catch (error) {
      console.error("Error upgrading subscription:", error);
      toast({ title: "שגיאה", description: "עדכון המנוי נכשל", variant: "destructive" });
    }
  };

  const handlePayment = async (paymentData) => {
    try {
      // כאן יהיה האינטגרציה עם ספק התשלומים
      const payment = await Payment.create({
        farm_id: currentFarm.id,
        subscription_id: subscription.id,
        amount: paymentData.amount,
        payment_date: new Date().toISOString(),
        payment_method: paymentData.method,
        status: 'completed',
        invoice_number: `INV-${Date.now()}`
      });

      // עדכון סטטוס המנוי לפעיל
      await Subscription.update(subscription.id, {
        status: 'active',
        last_payment_date: format(new Date(), 'yyyy-MM-dd'),
        next_payment_date: format(addYears(new Date(), 1), 'yyyy-MM-dd')
      });

      toast({ title: "הצלחה", description: "התשלום בוצע בהצלחה" });
      setIsPaymentDialogOpen(false);
      loadSubscription();
    } catch (error) {
      console.error("Error processing payment:", error);
      toast({ title: "שגיאה", description: "עיבוד התשלום נכשל", variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="flex justify-center items-center h-48">טוען פרטי מנוי...</div>;
  }

  const daysUntilExpiry = getDaysUntilExpiry();

  return (
    <div className="space-y-6">
      {/* כרטיס מנוי נוכחי */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            מנוי נוכחי - {currentFarm.name}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subscription ? (
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-xl font-bold">{plans[subscription.plan_type]?.name}</h3>
                  <p className="text-gray-600">₪{subscription.annual_price.toLocaleString()} לשנה</p>
                </div>
                {getStatusBadge(subscription.status)}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-3 bg-gray-50 rounded">
                  <div className="text-2xl font-bold text-blue-600">{subscription.max_plots === -1 ? "∞" : subscription.max_plots}</div>
                  <div className="text-sm text-gray-600">חלקות</div>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded">
                  <div className="text-2xl font-bold text-green-600">{subscription.max_employees === -1 ? "∞" : subscription.max_employees}</div>
                  <div className="text-sm text-gray-600">עובדים</div>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded">
                  <div className="text-2xl font-bold text-purple-600">{subscription.max_seedings === -1 ? "∞" : subscription.max_seedings}</div>
                  <div className="text-sm text-gray-600">מזרעים</div>
                </div>
              </div>

              {subscription.end_date && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4" />
                  <span>תוקף עד: {format(new Date(subscription.end_date), 'dd/MM/yyyy')}</span>
                  {daysUntilExpiry !== null && (
                    <Badge variant={daysUntilExpiry < 30 ? "destructive" : "outline"}>
                      {daysUntilExpiry > 0 ? `${daysUntilExpiry} ימים` : "פג תוקף"}
                    </Badge>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                {(subscription.status === 'pending_payment' || subscription.status === 'expired') && (
                  <Button onClick={() => setIsPaymentDialogOpen(true)}>
                    בצע תשלום
                  </Button>
                )}
                <Button variant="outline" onClick={() => setIsUpgradeDialogOpen(true)}>
                  שדרג מנוי
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-600 mb-4">לא נמצא מנוי פעיל למשק זה</p>
              <Button onClick={() => setIsUpgradeDialogOpen(true)}>
                בחר מנוי
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* היסטוריית תשלומים */}
      {payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>היסטוריית תשלומים</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>תאריך</TableHead>
                  <TableHead>סכום</TableHead>
                  <TableHead>שיטת תשלום</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead>מספר חשבונית</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{format(new Date(payment.payment_date), 'dd/MM/yyyy')}</TableCell>
                    <TableCell>₪{payment.amount.toLocaleString()}</TableCell>
                    <TableCell>{payment.payment_method}</TableCell>
                    <TableCell>
                      <Badge variant={payment.status === 'completed' ? 'default' : 'secondary'}>
                        {payment.status === 'completed' ? 'הושלם' : payment.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{payment.invoice_number}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* דיאלוג שדרוג מנוי */}
      <Dialog open={isUpgradeDialogOpen} onOpenChange={setIsUpgradeDialogOpen}>
        <DialogContent className="max-w-4xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>בחירת מנוי</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
            {Object.entries(plans).map(([planType, plan]) => (
              <Card key={planType} className={`cursor-pointer hover:shadow-lg transition-shadow ${subscription?.plan_type === planType ? 'ring-2 ring-blue-500' : ''}`}>
                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <div className="text-2xl font-bold">₪{plan.price.toLocaleString()}</div>
                  <div className="text-sm text-gray-600">לשנה</div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 mb-4">
                    <div>חלקות: {plan.max_plots === -1 ? "ללא הגבלה" : plan.max_plots}</div>
                    <div>עובדים: {plan.max_employees === -1 ? "ללא הגבלה" : plan.max_employees}</div>
                    <div>מזרעים: {plan.max_seedings === -1 ? "ללא הגבלה" : plan.max_seedings}</div>
                  </div>
                  <div className="space-y-1">
                    {plan.features.map((feature, index) => (
                      <div key={index} className="text-sm flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        {feature}
                      </div>
                    ))}
                  </div>
                  <Button 
                    className="w-full mt-4" 
                    onClick={() => handleUpgrade(planType)}
                    disabled={subscription?.plan_type === planType}
                  >
                    {subscription?.plan_type === planType ? "מנוי נוכחי" : "בחר מנוי"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* דיאלוג תשלום */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>ביצוע תשלום</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-lg font-bold">סכום לתשלום: ₪{subscription?.annual_price.toLocaleString()}</div>
              <div className="text-sm text-gray-600">עבור מנוי {plans[subscription?.plan_type]?.name} לשנה</div>
            </div>
            <div className="space-y-2">
              <Label>שיטת תשלום</Label>
              <Select defaultValue="credit_card">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit_card">כרטיס אשראי</SelectItem>
                  <SelectItem value="bank_transfer">העברה בנקאית</SelectItem>
                  <SelectItem value="invoice">חשבונית</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)}>
              ביטול
            </Button>
            <Button onClick={() => handlePayment({ amount: subscription?.annual_price, method: 'credit_card' })}>
              אשר תשלום
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}