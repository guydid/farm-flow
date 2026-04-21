import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, TrendingUp, RefreshCw, Search, ExternalLink } from "lucide-react";

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export default function MarketPricesPanel({ cropName }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prices, setPrices] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState(cropName || '');

  const fetchPrices = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_URL}/functions/fetchMarketPrices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.data?.success) {
        setPrices(data.data.prices || []);
        setFetchedAt(data.data.fetched_at);
        setFromCache(data.data.from_cache || false);
      } else {
        setError(data.data?.error || 'שגיאה בטעינת המחירים');
      }
    } catch (e) {
      setError('לא ניתן להגיע לשרת');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    if (prices.length === 0) fetchPrices();
  };

  const filtered = prices.filter(p =>
    !search.trim() || p.name.includes(search.trim())
  );

  const formatDate = (d) => {
    if (!d) return '';
    // Convert from dd/MM/yy to dd/MM/yyyy
    const parts = d.split('/');
    if (parts.length === 3 && parts[2].length === 2) {
      return `${parts[0]}/${parts[1]}/20${parts[2]}`;
    }
    return d;
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleOpen}
        className="flex items-center gap-2 text-green-700 border-green-300 hover:bg-green-50"
      >
        <TrendingUp className="w-4 h-4" />
        מחירון שוק
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              מחירון שוק ירקות — מועצת הצמחים
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-2.5 w-4 h-4 text-gray-400" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="חפש ירק..."
                className="pr-9"
              />
            </div>
            <Button variant="outline" size="icon" onClick={fetchPrices} disabled={isLoading} title="רענן">
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
          </div>

          {fetchedAt && (
            <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
              <span>עדכון: {formatDate(prices[0]?.date)}</span>
              <div className="flex items-center gap-2">
                {fromCache && <Badge variant="outline" className="text-xs">מהמטמון</Badge>}
                <a href="https://plants.moonsite.co.il/" target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-1 text-blue-600 hover:underline">
                  מקור <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
          )}

          {isLoading && prices.length === 0 ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-green-500" />
              <span className="mr-3 text-gray-500">טוען מחירים מהמועצה...</span>
            </div>
          ) : (
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 border-b">
                  <tr>
                    <th className="text-right py-2 px-3 font-medium text-gray-700">שם הירק</th>
                    <th className="text-center py-2 px-3 font-medium text-gray-700">סוג א' ₪/ק"ג</th>
                    <th className="text-center py-2 px-3 font-medium text-gray-700">מובחר ₪/ק"ג</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => (
                    <tr key={i} className={`border-b hover:bg-gray-50 ${p.name === cropName ? 'bg-green-50 font-medium' : ''}`}>
                      <td className="py-2 px-3">{p.name}</td>
                      <td className="text-center py-2 px-3">
                        {p.grade_a != null ? (
                          <span className="font-semibold text-green-700">{p.grade_a.toFixed(2)}</span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="text-center py-2 px-3">
                        {p.premium != null ? (
                          <span className="font-semibold text-blue-700">{p.premium.toFixed(2)}</span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && !isLoading && (
                    <tr>
                      <td colSpan={3} className="text-center py-8 text-gray-400">לא נמצאו תוצאות</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-gray-400 mt-2 text-center">
            המחירים סיטונאיים ומהווים אינדיקציה בלבד — מועצת הצמחים
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
