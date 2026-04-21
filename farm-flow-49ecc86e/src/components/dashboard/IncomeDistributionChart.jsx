
import React, { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

export default function IncomeDistributionChart({ harvests, seedings }) {
  const data = useMemo(() => {
    const safeHarvests = Array.isArray(harvests) ? harvests : [];
    const safeSeedings = Array.isArray(seedings) ? seedings : [];

    if (safeHarvests.length === 0) {
      return [];
    }

    const aggregatedData = safeHarvests.reduce((acc, harvest) => {
      // Ensure harvest and its critical properties exist before processing
      if (!harvest || typeof harvest !== 'object' || 
          !harvest.seeding_id || typeof harvest.seeding_id === 'undefined' ||
          typeof harvest.price_per_unit === 'undefined' || typeof harvest.quantity === 'undefined') {
        return acc;
      }

      const seeding = safeSeedings.find(s => s && s.id === harvest.seeding_id);
      const cropType = seeding?.crop_type || 'לא ידוע'; // Fallback changed to 'לא ידוע' as per outline

      // Convert to numbers safely
      const quantity = parseFloat(harvest.quantity) || 0;
      const price = parseFloat(harvest.price_per_unit) || 0;
      const revenue = quantity * price;

      // Only aggregate if there's actual revenue
      if (revenue > 0) {
        if (!acc[cropType]) {
          acc[cropType] = { name: cropType, revenue: 0 };
        }
        acc[cropType].revenue += revenue;
      }
      return acc;
    }, {});
    
    // Convert the aggregated object into an array of values, ready for the chart
    // Filter out items with 0 revenue to keep the chart clean, and sort by revenue
    return Object.values(aggregatedData)
      .filter(item => item.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [harvests, seedings]);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && Array.isArray(payload) && payload.length) {
      const tooltipData = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-200 rounded shadow-sm" dir="rtl">
          <p className="font-bold mb-2">{tooltipData.name}</p>
          {/* Updated to use 'revenue' instead of 'value' */}
          <p className="text-sm">הכנסות: ₪{tooltipData.revenue ? tooltipData.revenue.toLocaleString() : '0'}</p>
          {/* 'count' is no longer calculated in the new data structure, so it's removed from the tooltip */}
        </div>
      );
    }
    return null;
  };

  // Check if data is valid and has elements for rendering
  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>התפלגות הכנסות לפי סוג גידול</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-gray-500">
            אין נתוני הכנסות להצגה
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>התפלגות הכנסות לפי סוג גידול</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data} // Use 'data' instead of 'chartData'
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={80}
                fill="#8884d8"
                dataKey="revenue" // Updated dataKey from 'value' to 'revenue'
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {data.map((entry, index) => ( // Use 'data' instead of 'chartData'
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
