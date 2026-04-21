import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Farm, User, Subscription, CompanySettings } from '@/entities/all';
import { Loader2 } from 'lucide-react';
import { addYears, format } from 'date-fns';

export default function CreateFarmDialog({ open, onClose, onSuccess }) {
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    company_type: 'farm',
    address: '',
    phone: '',
    email: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.name) {
      toast({
        title: "שגיאה",
        description: "נא למלא שם משק",
        variant: "destructive"
      });
      return;
    }

    setIsCreating(true);

    try {
      // Get current user
      const currentUser = await User.me();
      if (!currentUser) {
        throw new Error('לא נמצא משתמש מחובר');
      }

      // Step 1: Create the farm
      const newFarm = await Farm.create({
        name: formData.name,
        description: formData.description,
        owner_id: currentUser.id,
        settings: {
          company_name: formData.name,
          company_type: formData.company_type,
          address: formData.address,
          phone: formData.phone,
          email: formData.email
        }
      });

      console.log('Farm created:', newFarm);

      // Step 2: Create initial company settings
      try {
        await CompanySettings.create({
          farm_id: newFarm.id,
          company_name: formData.name,
          company_type: formData.company_type,
          address: formData.address,
          phone: formData.phone,
          email: formData.email,
          printer_settings: {
            printer_type: 'browser',
            enable_direct_print: false,
            sticker_width: '100',
            sticker_height: '70',
            print_darkness: '15',
            print_speed: '4'
          }
        });
        console.log('Company settings created');
      } catch (settingsError) {
        console.warn('Failed to create company settings:', settingsError);
        // Not critical, continue
      }

      // Step 3: Create trial subscription
      const today = new Date();
      const trialEndDate = addYears(today, 1); // 1 year trial
      
      try {
        await Subscription.create({
          farm_id: newFarm.id,
          plan_type: 'basic',
          plan_name: 'בסיסי',
          status: 'trial',
          start_date: format(today, 'yyyy-MM-dd'),
          end_date: format(trialEndDate, 'yyyy-MM-dd'),
          trial_end_date: format(trialEndDate, 'yyyy-MM-dd'),
          annual_price: 0, // Free during trial
          max_plots: 5,
          max_employees: 10,
          max_seedings: 20,
          features: ["מעקב חלקות", "ניהול עובדים", "מעקב מזרעים", "דוחות בסיסיים"],
          auto_renewal: false
        });
        console.log('Trial subscription created');
      } catch (subscriptionError) {
        console.warn('Failed to create subscription:', subscriptionError);
        // Not critical, continue
      }

      // Step 4: Update user's farm list and set as current farm
      const updatedFarmIds = [...(currentUser.farm_ids || []), newFarm.id];
      await User.updateMyUserData({
        farm_ids: updatedFarmIds,
        current_farm_id: newFarm.id
      });

      console.log('User updated with new farm');

      toast({
        title: "הצלחה!",
        description: `המשק "${formData.name}" נוצר בהצלחה`
      });

      // Reset form
      setFormData({
        name: '',
        description: '',
        company_type: 'farm',
        address: '',
        phone: '',
        email: ''
      });

      // Call success callback with the new farm
      if (onSuccess) {
        onSuccess(newFarm);
      }

      onClose();

    } catch (error) {
      console.error('Error creating farm:', error);
      toast({
        title: "שגיאה ביצירת משק",
        description: error.message || "אירעה שגיאה לא צפויה",
        variant: "destructive"
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>צור משק חדש</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">שם המשק *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="למשל: משק דוד"
              required
              disabled={isCreating}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="company_type">סוג ישות</Label>
            <Select 
              value={formData.company_type} 
              onValueChange={(value) => setFormData({ ...formData, company_type: value })}
              disabled={isCreating}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="farm">משק חקלאי</SelectItem>
                <SelectItem value="cooperative">אגודה שיתופית</SelectItem>
                <SelectItem value="company">חברה</SelectItem>
                <SelectItem value="moshav">מושב</SelectItem>
                <SelectItem value="kibbutz">קיבוץ</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">תיאור (אופציונלי)</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="תיאור קצר על המשק..."
              disabled={isCreating}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">כתובת (אופציונלי)</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="כתובת המשק"
              disabled={isCreating}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">טלפון (אופציונלי)</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="מספר טלפון"
                disabled={isCreating}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">אימייל (אופציונלי)</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="כתובת אימייל"
                disabled={isCreating}
              />
            </div>
          </div>

          <DialogFooter>
            <Button 
              type="button" 
              variant="outline" 
              onClick={onClose}
              disabled={isCreating}
            >
              ביטול
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  יוצר משק...
                </>
              ) : (
                'צור משק'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}