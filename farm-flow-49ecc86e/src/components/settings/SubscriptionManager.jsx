import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Calendar, CheckCircle, Clock, AlertTriangle } from "lucide-react";

// מצב המנוי של המשק — נקבע בשרת בלבד (farm.plan / trial_ends_at).
// אין כאן תשלום או שדרוג עצמי: הארכה / הפעלת מנוי נעשות ע"י מנהל המערכת.
export default function SubscriptionManager({ currentFarm }) {
  if (!currentFarm) return null;
  const plan = currentFarm.plan || null;
  const endsAt = currentFarm.trial_ends_at ? new Date(currentFarm.trial_ends_at) : null;
  const daysLeft = endsAt ? Math.ceil((endsAt - new Date()) / 864e5) : null;
  const expired = plan === "trial" && daysLeft !== null && daysLeft <= 0;

  let badge, title, body;
  if (plan === "trial") {
    badge = expired
      ? <Badge variant="destructive" className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" />הסתיימה</Badge>
      : <Badge variant="secondary" className="flex items-center gap-1"><Clock className="w-3 h-3" />תקופת ניסיון</Badge>;
    title = "תקופת ניסיון";
    body = expired
      ? "תקופת הניסיון הסתיימה והמשק במצב צפייה בלבד. הנתונים שמורים — להארכה או להפעלת מנוי פנה למנהל המערכת."
      : `נותרו ${daysLeft} ימים לתקופת הניסיון. להפעלת מנוי קבוע פנה למנהל המערכת.`;
  } else {
    badge = <Badge className="flex items-center gap-1"><CheckCircle className="w-3 h-3" />פעיל</Badge>;
    title = "מנוי פעיל";
    body = "המשק פעיל ללא הגבלת זמן.";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="w-5 h-5" />
          מנוי — {currentFarm.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between items-start gap-3">
          <h3 className="text-xl font-bold">{title}</h3>
          {badge}
        </div>
        <p className="text-gray-600">{body}</p>
        {plan === "trial" && endsAt && (
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4" />
            <span>{expired ? "הסתיימה ב-" : "בתוקף עד "}{endsAt.toLocaleDateString("he-IL")}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
