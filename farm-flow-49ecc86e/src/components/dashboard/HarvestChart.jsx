
import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format, parseISO } from 'date-fns'; // Keep these imports, even if parseISO and format are not directly used in new data logic, they might be in other parts of the app or future extensions.
import { he } from 'date-fns/locale';

export default function HarvestChart({ harvests, seedings }) {
  const chartData = useMemo(() => {
    try {
      const safeHarvests = Array.isArray(harvests) ? harvests : [];
      if (safeHarvests.length === 0) return [];

      const aggregatedData = safeHarvests.reduce((acc, harvest) => {
        // Ensure harvest object and required properties exist
        if (!harvest || !harvest.seeding_id || typeof harvest.weight === 'undefined' || harvest.weight === null) {
          return acc;
        }
        const safeSeedings = Array.isArray(seedings) ? seedings : [];
        const seeding = safeSeedings.find(s => s && s.id === harvest.seeding_id);
        const cropType = seeding?.crop_type || 'לא ידוע'; // Default to 'לא ידוע' if crop_type is missing

        if (!acc[cropType]) {
          acc[cropType] = { name: cropType, weight: 0 };
        }
        acc[cropType].weight += parseFloat(harvest.weight) || 0; // Ensure weight is treated as a number
        return acc;
      }, {});

      return Object.values(aggregatedData);
    } catch (error) {
      console.error('Error in HarvestChart useMemo:', error);
      return [];
    }
  }, [harvests, seedings]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && Array.isArray(payload) && payload.length) {
      return (
        <div className="bg-white p-3 border border-gray-200 rounded shadow-sm" dir="rtl">
          <p className="font-bold mb-2">{label}</p>
          <p className="text-sm">
            <span className="inline-block w-3 h-3 bg-green-500 rounded-full ml-2"></span>
            משקל: {(payload[0]?.value || 0).toLocaleString()} ק"ג
          </p>
        </div>
      );
    }
    return null;
  };

  if (!chartData || !Array.isArray(chartData) || chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>קטיפים לפי סוג גידול</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-gray-500">
            אין נתוני קטיפים להצגה
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>קטיפים לפי סוג גידול</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis yAxisId="weight" orientation="right" />
              <Tooltip content={<CustomTooltip />} />
              <Bar yAxisId="weight" dataKey="weight" fill="#10B981" name="משקל" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
