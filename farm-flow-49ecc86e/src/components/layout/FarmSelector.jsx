import React, { useState, useEffect } from 'react';
import { Farm, User } from '@/entities/all';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Building2, Check, Plus, Loader2 } from 'lucide-react';
import CreateFarmDialog from '../onboarding/CreateFarmDialog';

export default function FarmSelector({ currentUser, currentFarm, onFarmChange }) {
  const [farms, setFarms] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    loadFarms();
  }, [currentUser]);

  const loadFarms = async () => {
    if (!currentUser?.farm_ids || currentUser.farm_ids.length === 0) {
      setFarms([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const farmPromises = currentUser.farm_ids.map(async (farmId) => {
        try {
          const farm = await Farm.get(farmId);
          return farm;
        } catch (error) {
          console.warn(`Failed to load farm ${farmId}:`, error);
          return null;
        }
      });
      
      const farmsData = await Promise.all(farmPromises);
      const validFarms = farmsData.filter(f => f !== null);
      
      setFarms(validFarms);
      
      // If current farm is not valid, clean it up
      if (currentUser.current_farm_id && !validFarms.find(f => f.id === currentUser.current_farm_id)) {
        console.log('Current farm ID is invalid, clearing it');
        const newFarmIds = validFarms.map(f => f.id);
        await User.updateMyUserData({ 
          current_farm_id: validFarms.length > 0 ? validFarms[0].id : null,
          farm_ids: newFarmIds
        });
        
        if (validFarms.length > 0 && onFarmChange) {
          onFarmChange(validFarms[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load farms:', error);
      setFarms([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFarmSelect = async (farm) => {
    if (farm.id === currentFarm?.id) {
      return;
    }

    try {
      console.log('FarmSelector - Switching to farm:', farm.id);
      
      await User.updateMyUserData({ current_farm_id: farm.id });
      
      if (onFarmChange) {
        onFarmChange(farm);
      }
    } catch (error) {
      console.error('Failed to switch farm:', error);
    }
  };

  const handleFarmCreated = (newFarm) => {
    setIsDialogOpen(false);
    loadFarms();
    if (onFarmChange) {
      onFarmChange(newFarm);
    }
  };

  if (isLoading) {
    return (
      <Button variant="outline" disabled>
        <Loader2 className="w-4 h-4 ml-2 animate-spin" />
        טוען...
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Building2 className="w-4 h-4" />
            {currentFarm ? currentFarm.name : 'בחר משק'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" dir="rtl">
          <DropdownMenuLabel>המשקים שלי</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {farms.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-gray-500">
              אין משקים
            </div>
          ) : (
            farms.map((farm) => (
              <DropdownMenuItem
                key={farm.id}
                onClick={() => handleFarmSelect(farm)}
                className="cursor-pointer"
              >
                <div className="flex items-center justify-between w-full">
                  <span>{farm.name}</span>
                  {currentFarm?.id === farm.id && (
                    <Check className="w-4 h-4 text-green-600" />
                  )}
                </div>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setIsDialogOpen(true)}
            className="cursor-pointer text-blue-600"
          >
            <Plus className="w-4 h-4 ml-2" />
            צור משק חדש
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateFarmDialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSuccess={handleFarmCreated}
      />
    </>
  );
}