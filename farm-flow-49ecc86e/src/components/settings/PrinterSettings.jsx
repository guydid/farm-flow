
import React, { useState, useEffect } from "react";
import { CompanySettings } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Printer, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

export default function PrinterSettings({ currentFarm }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [zebraPrinters, setZebraPrinters] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState(null);

  const [printerConfig, setPrinterConfig] = useState({
    printer_type: 'browser',
    zebra_printer_name: '',
    enable_direct_print: false,
    sticker_width: '100',
    sticker_height: '70',
    print_darkness: '15',
    print_speed: '4'
  });

  useEffect(() => {
    loadSettings();
  }, [currentFarm]); // Added currentFarm to dependencies to reload settings if it changes

  useEffect(() => {
    if (printerConfig.printer_type === 'zebra') {
      detectZebraPrinters();
    }
  }, [printerConfig.printer_type]);

  const detectZebraPrinters = async () => {
    try {
      // Try to connect to Zebra Browser Print API
      const response = await fetch('http://localhost:9100/available', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to connect to Zebra Browser Print');
      }

      const data = await response.json();
      console.log('Zebra Browser Print response:', data);

      if (data && data.printer && data.printer.length > 0) {
        setZebraPrinters(data.printer);
        if (!printerConfig.zebra_printer_name && data.printer[0].name) {
          setPrinterConfig(prev => ({ ...prev, zebra_printer_name: data.printer[0].name }));
        }
        setConnectionStatus('connected');
        toast({
          title: "מדפסות נמצאו",
          description: `נמצאו ${data.printer.length} מדפסות Zebra`
        });
      } else {
        setConnectionStatus('disconnected');
        toast({
          title: "לא נמצאו מדפסות",
          description: "לא נמצאו מדפסות Zebra מחוברות",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error detecting Zebra printers:', error);
      setConnectionStatus('error');
      toast({
        title: "שגיאת חיבור",
        description: "לא הצלחנו להתחבר ל-Zebra Browser Print. ודא שהתוכנה מותקנת ופועלת.",
        variant: "destructive"
      });
    }
  };

  const loadSettings = async () => {
    if (!currentFarm) {
      setIsLoading(false); // Ensure loading state is reset even if no farm
      return;
    }

    setIsLoading(true);
    try {
      const settingsData = await CompanySettings.filter({ farm_id: currentFarm.id });
      let farmSettings = Array.isArray(settingsData) && settingsData.length > 0 ? settingsData[0] : null;
      
      // If no settings exist, create them
      if (!farmSettings) {
        console.log('No company settings found, creating default settings...');
        farmSettings = await CompanySettings.create({
          farm_id: currentFarm.id,
          company_name: currentFarm.name || '',
          company_type: 'farm',
          printer_settings: printerConfig // Use the current default printerConfig state
        });
        toast({
          title: "הגדרות חדשות",
          description: "נוצרו הגדרות מדפסת חדשות עבור המשק"
        });
      }
      
      setSettings(farmSettings);

      if (farmSettings?.printer_settings) {
        setPrinterConfig(prev => ({
          ...prev,
          ...farmSettings.printer_settings
        }));
      }
    } catch (error) {
      console.error("Failed to load printer settings:", error);
      toast({
        title: "שגיאה",
        description: "לא הצלחנו לטעון את הגדרות המדפסת",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const sendZPLToPrinter = async (zpl, printerName) => {
    try {
      // Get the selected printer or default printer
      let selectedPrinter = printerName;
      
      if (!selectedPrinter && zebraPrinters.length > 0) {
        selectedPrinter = zebraPrinters[0].uid || zebraPrinters[0].name;
      }

      if (!selectedPrinter) {
        throw new Error('לא נבחרה מדפסת');
      }

      // Send ZPL to printer
      const response = await fetch('http://localhost:9100/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', // Changed to application/json for consistency
        },
        body: JSON.stringify({
          device: {
            name: selectedPrinter,
            uid: selectedPrinter
          },
          data: zpl
        })
      });

      if (!response.ok) {
        throw new Error('Failed to send print job');
      }

      return true;
    } catch (error) {
      console.error('Error sending ZPL to printer:', error);
      throw error;
    }
  };

  const testConnection = async () => {
    setIsTestingConnection(true);
    
    try {
      if (printerConfig.printer_type === 'zebra') {
        // Check if Zebra Browser Print is running
        const response = await fetch('http://localhost:9100/available', {
          method: 'GET',
        });

        if (!response.ok) {
          throw new Error('Zebra Browser Print לא זמין. ודא שהתוכנה פועלת.');
        }

        const data = await response.json();
        
        if (!data || !data.printer || data.printer.length === 0) {
          throw new Error('לא נמצאו מדפסות Zebra מחוברות');
        }

        // Test print
        const testZPL = `
^XA
^CI28
^FO50,50^A0N,40,40^FDTest Print^FS
^FO50,100^A0N,25,25^FD${new Date().toLocaleString('he-IL')}^FS
^FO50,140^A0N,25,25^FDConnection OK!^FS
^XZ
        `;

        await sendZPLToPrinter(testZPL, printerConfig.zebra_printer_name);

        setConnectionStatus('connected');
        toast({
          title: "החיבור תקין!",
          description: "המדפסת מחוברת ומוכנה להדפסה"
        });

      } else {
        toast({
          title: "מצב רגיל",
          description: "במצב הדפסה רגילה, תיפתח חלון הדפסה של הדפדפן"
        });
        setConnectionStatus('browser');
      }
    } catch (error) {
      console.error('Connection test failed:', error);
      toast({
        title: "החיבור נכשל",
        description: error.message || "לא הצלחנו להתחבר למדפסת.",
        variant: "destructive"
      });
      setConnectionStatus('error');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSave = async () => {
    if (!currentFarm) {
      toast({
        title: "שגיאה",
        description: "לא נבחר משק פעיל",
        variant: "destructive"
      });
      return;
    }

    setIsSaving(true);
    try {
      if (settings) {
        // Update existing settings
        await CompanySettings.update(settings.id, {
          printer_settings: printerConfig
        });
      } else {
        // Create new settings if `settings` state is null (meaning no existing settings were loaded)
        const newSettings = await CompanySettings.create({
          farm_id: currentFarm.id,
          company_name: currentFarm.name || '',
          company_type: 'farm',
          printer_settings: printerConfig
        });
        setSettings(newSettings); // Important: update the settings state after creation
      }

      toast({
        title: "נשמר!",
        description: "הגדרות המדפסת נשמרו בהצלחה"
      });

      loadSettings(); // Reload settings to ensure everything is in sync
    } catch (error) {
      console.error('Failed to save printer settings:', error);
      toast({
        title: "שגיאה בשמירה",
        description: "לא הצלחנו לשמור את ההגדרות. נסה שוב.",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'disconnected':
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      case 'browser':
        return <Printer className="h-5 w-5 text-blue-600" />;
      default:
        return <Printer className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'מחובר';
      case 'disconnected':
        return 'מנותק';
      case 'error':
        return 'שגיאה';
      case 'browser':
        return 'מצב רגיל';
      default:
        return 'לא נבדק';
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center items-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  // If currentFarm is null after loading, display a message
  if (!currentFarm) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            הגדרות מדפסת מדבקות
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-500">יש לבחור משק כדי להציג ולנהל הגדרות מדפסת.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Printer className="h-5 w-5" />
          הגדרות מדפסת מדבקות
        </CardTitle>
        <CardDescription>
          הגדר הדפסה ישירה למדפסת מדבקות ללא דיאלוג הדפסה
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Connection Status */}
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="font-medium">סטטוס:</span>
            <span>{getStatusText()}</span>
          </div>
          <Button 
            variant="outline" 
            onClick={testConnection}
            disabled={isTestingConnection}
          >
            {isTestingConnection ? (
              <>
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                בודק...
              </>
            ) : (
              'בדוק חיבור'
            )}
          </Button>
        </div>

        {/* Printer Type */}
        <div className="space-y-2">
          <Label>סוג מדפסת</Label>
          <Select
            value={printerConfig.printer_type}
            onValueChange={(value) => {
              setPrinterConfig(prev => ({ ...prev, printer_type: value }));
              setConnectionStatus(null);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="browser">הדפסה רגילה (דפדפן)</SelectItem>
              <SelectItem value="zebra">Zebra (הדפסה ישירה)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {printerConfig.printer_type === 'browser' && 'הדפסה דרך דיאלוג הדפסה רגיל של הדפדפן'}
            {printerConfig.printer_type === 'zebra' && 'הדפסה ישירה למדפסת Zebra ללא דיאלוג (דורש התקנת Zebra Browser Print)'}
          </p>
        </div>

        {/* Zebra Specific Settings */}
        {printerConfig.printer_type === 'zebra' && (
          <>
            <div className="space-y-2">
              <Label>מדפסת Zebra</Label>
              <div className="flex gap-2">
                <Select
                  value={printerConfig.zebra_printer_name}
                  onValueChange={(value) => setPrinterConfig(prev => ({ ...prev, zebra_printer_name: value }))}
                  disabled={zebraPrinters.length === 0}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={zebraPrinters.length === 0 ? "לא נמצאו מדפסות" : "בחר מדפסת"} />
                  </SelectTrigger>
                  <SelectContent>
                    {zebraPrinters.map((printer, index) => (
                      <SelectItem key={index} value={printer.name || printer.uid}>
                        {printer.name || printer.uid}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button 
                  variant="outline" 
                  onClick={detectZebraPrinters}
                  disabled={isTestingConnection}
                >
                  רענן
                </Button>
              </div>
              {zebraPrinters.length === 0 && (
                <p className="text-xs text-red-600">
                  לא נמצאו מדפסות Zebra. ודא ש-Zebra Browser Print מותקן ופועל.
                </p>
              )}
              {zebraPrinters.length > 0 && (
                <p className="text-xs text-green-600">
                  נמצאו {zebraPrinters.length} מדפסות
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>רוחב מדבקה (מ"מ)</Label>
                <Input
                  type="number"
                  value={printerConfig.sticker_width}
                  onChange={(e) => setPrinterConfig(prev => ({ ...prev, sticker_width: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>גובה מדבקה (מ"מ)</Label>
                <Input
                  type="number"
                  value={printerConfig.sticker_height}
                  onChange={(e) => setPrinterConfig(prev => ({ ...prev, sticker_height: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>עוצמת הדפסה (0-30)</Label>
                <Input
                  type="number"
                  min="0"
                  max="30"
                  value={printerConfig.print_darkness}
                  onChange={(e) => setPrinterConfig(prev => ({ ...prev, print_darkness: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>מהירות הדפסה (1-14)</Label>
                <Input
                  type="number"
                  min="1"
                  max="14"
                  value={printerConfig.print_speed}
                  onChange={(e) => setPrinterConfig(prev => ({ ...prev, print_speed: e.target.value }))}
                />
              </div>
            </div>

            {/* Enable Direct Print */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>הפעל הדפסה ישירה</Label>
                <p className="text-sm text-muted-foreground">
                  הדפס אוטומטית ללא אישור
                </p>
              </div>
              <Switch
                checked={printerConfig.enable_direct_print}
                onCheckedChange={(checked) => setPrinterConfig(prev => ({ ...prev, enable_direct_print: checked }))}
              />
            </div>
          </>
        )}

        {/* Save Button */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                שומר...
              </>
            ) : (
              'שמור הגדרות'
            )}
          </Button>
        </div>

        {/* Help Text */}
        <div className="bg-blue-50 p-4 rounded-lg">
          <h4 className="font-medium mb-2">איך להתקין Zebra Browser Print?</h4>
          <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
            <li>
              הורד את{' '}
              <a href="https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                Zebra Browser Print
              </a>
            </li>
            <li>התקן את התוכנה במחשב</li>
            <li>חבר את מדפסת Zebra דרך USB או רשת</li>
            <li>ודא ש-Browser Print פועל ברקע (יופיע באיקון במגש המערכת)</li>
            <li>לחץ על "בדוק חיבור" או "רענן" לחיפוש מדפסות</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}

// Export the print function for use in other components
export const printZPLLabel = async (zpl, printerName = null) => {
  try {
    const response = await fetch('http://localhost:9100/write', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device: printerName ? { name: printerName } : undefined,
        data: zpl
      })
    });

    if (!response.ok) {
      throw new Error('Failed to print');
    }

    return true;
  } catch (error) {
    console.error('Print error:', error);
    throw error;
  }
};
