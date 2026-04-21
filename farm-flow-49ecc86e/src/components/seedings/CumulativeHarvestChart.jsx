import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format, parseISO } from 'date-fns';
import { he } from 'date-fns/locale';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-2 border rounded shadow-sm">
        <p className="font-semibold">{`תאריך: ${label}`}</p>
        <p className="text-sm">{`קטיף מצטבר: ${payload[0].value.toFixed(1)} ק"ג`}</p>
        {payload[0].payload.perDunam && (
          <p className="text-sm text-gray-600">{`מצטבר לדונם: ${payload[0].payload.perDunam.toFixed(1)} ק"ג`}</p>
        )}
      </div>
    );
  }
  return null;
};

export default function CumulativeHarvestChart({ harvests, seeding }) {
  const data = React.useMemo(() => {
    // Safe array handling
    const safeHarvests = Array.isArray(harvests) ? harvests : [];
    if (safeHarvests.length === 0) return [];

    const sortedHarvests = [...safeHarvests].sort((a, b) => {
      try {
        return new Date(a.date) - new Date(b.date);
      } catch (error) {
        console.warn('Error sorting harvests by date:', error);
        return 0;
      }
    });
    
    let cumulativeWeight = 0;
    
    return sortedHarvests.map(harvest => {
      const weight = typeof harvest.weight === 'number' ? harvest.weight : 0;
      cumulativeWeight += weight;
      
      let perDunam = null;
      if (seeding && typeof seeding.total_area === 'number' && seeding.total_area > 0) {
        perDunam = cumulativeWeight / seeding.total_area;
      }
      
      try {
        return {
          date: format(parseISO(harvest.date), 'dd/MM'),
          cumulativeWeight: cumulativeWeight,
          perDunam: perDunam,
        };
      } catch (error) {
        console.warn('Error formatting harvest date:', error);
        return {
          date: 'תאריך לא תקין',
          cumulativeWeight: cumulativeWeight,
          perDunam: perDunam,
        };
      }
    });
  }, [harvests, seeding]);

  if (data.length < 2) {
    return (
        <Card className="h-full flex items-center justify-center">
            <CardContent>
                <p className="text-gray-500 text-center">נדרשים לפחות שני קטיפים כדי להציג גרף</p>
            </CardContent>
        </Card>
    );
  }
  
  const totalDunamHarvest = (seeding?.total_area && data.length > 0) ? (data[data.length-1].cumulativeWeight / seeding.total_area) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">קטיף מצטבר</CardTitle>
        {seeding?.total_area > 0 && (
          <p className="text-sm text-gray-500">
            סה"כ לדונם: <span className="font-bold text-green-600">{totalDunamHarvest.toLocaleString(undefined, {maximumFractionDigits: 1})} ק"ג</span>
          </p>
        )}
      </CardHeader>
      <CardContent className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="cumulativeWeight" stroke="#16a34a" fill="#dcfce7" name="קטיף מצטבר" />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}