import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building, Plus, UserPlus, Sprout } from 'lucide-react';
import CreateFarmDialog from './CreateFarmDialog';
import { useNavigate } from 'react-router-dom';

export default function WelcomeScreen({ currentUser, onFarmCreated }) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showJoinHelp, setShowJoinHelp] = useState(false);
  const navigate = useNavigate();

  const handleCreateSuccess = (newFarm) => {
    // Close dialog
    setShowCreateDialog(false);
    
    // Call parent callback
    if (onFarmCreated) {
      onFarmCreated(newFarm);
    }
    
    // Reload the page to refresh all data
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-blue-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <Sprout className="w-8 h-8 text-green-600" />
          </div>
          <CardTitle className="text-2xl">ברוכים הבאים ל-FarmFlow</CardTitle>
          <p className="text-gray-600 mt-2">
            שלום {currentUser?.full_name}, כדי להתחיל עליך ליצור את המשק הראשון שלך או להתחבר למשק קיים.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={() => setShowCreateDialog(true)}
            className="w-full h-12 text-base"
          >
            <Plus className="mr-2 h-5 w-5" />
            צור משק חדש
          </Button>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">או</span>
            </div>
          </div>
          
          <Button 
            variant="outline" 
            className="w-full h-12 text-base"
            onClick={() => setShowJoinHelp(v => !v)}
            aria-expanded={showJoinHelp}
          >
            <UserPlus className="mr-2 h-5 w-5" />
            הצטרף למשק קיים
          </Button>
          {showJoinHelp && (
            <p role="status" className="text-sm text-gray-700 bg-blue-50 border border-blue-200 rounded-lg p-3">
              כדי להצטרף למשק קיים, בקש מבעל המשק להזמין אותך מהמסך "חברי משק" לכתובת {currentUser?.email || 'המייל שלך'}.
              אחרי ההזמנה, היכנס מחדש והמשק יופיע אצלך.
            </p>
          )}
          
          <div className="text-center text-sm text-gray-500 mt-6">
            זקוק לעזרה? צור קשר עמנו בכתובת support@farmflow.co.il
          </div>
        </CardContent>
      </Card>

      <CreateFarmDialog 
        open={showCreateDialog} 
        onClose={() => setShowCreateDialog(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}