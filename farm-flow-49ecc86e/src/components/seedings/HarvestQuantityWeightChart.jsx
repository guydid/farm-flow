import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format, parseISO } from 'date-fns';

const QuantityTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const item = payload[0].payload;
    return (
      <div className="bg-white p-2 border rounded shadow-sm text-right">
        <p className="font-semibold">{`תאריך: ${label}`}</p>
        <p className="text-sm text-blue-600">{`כמות: ${item.quantity.toLocaleString()} יח'`}</p>
        {item.weight > 0 && (
          <p className="text-sm text-green-600">{`משקל: ${item.weight.toLocaleString(undefined, { maximumFractionDigits: 1 })} ק"ג`}</p>
        )}
      </div>
    );
  }
  return null;
};

export default function HarvestQuantityWeightChart({ harvests }) {
  const data = React.useMemo(() => {
    const safeHarvests = Array.isArray(harvests) ? harvests : [];
    if (safeHarvests.length === 0) return [];

    const sorted = [...safeHarvests]
      .filter(h => h && h.date)
      .sort((a, b) => {
        try {
          return new Date(a.date) - new Date(b.date);
        } catch {
          return 0;
        }
      });

    return sorted.map(h => {
      let dateLabel;
      try {
        dateLabel = format(parseISO(h.date), 'dd/MM');
      } catch {
        dateLabel = '-';
      }
      return {
        date: dateLabel,
        quantity: typeof h.quantity === 'number' ? h.quantity : 0,
        weight: typeof h.weight === 'number' ? h.weight : 0,
      };
    });
  }, [harvests]);

  if (data.length < 2) return null;

  const totalQuantity = data.reduce((sum, d) => sum + d.quantity, 0);
  const totalWeight = data.reduce((sum, d) => sum + d.weight, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">כמות ומשקל לפי קטיף</CardTitle>
          <div className="flex gap-4 text-sm">
            <span className="text-blue-600">
              סה"כ כמות: <span className="font-bold">{totalQuantity.toLocaleString()}</span> יח'
            </span>
            <span className="text-green-600">
              סה"כ משקל: <span className="font-bold">{totalWeight.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span> ק"ג
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-blue-600 mb-1 text-right">כמות (יח')</p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<QuantityTooltip />} />
                  <Bar dataKey="quantity" fill="#3b82f6" radius={[4, 4, 0, 0]} name="כמות" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-green-600 mb-1 text-right">משקל (ק"ג)</p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<QuantityTooltip />} />
                  <Bar dataKey="weight" fill="#16a34a" radius={[4, 4, 0, 0]} name="משקל" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
