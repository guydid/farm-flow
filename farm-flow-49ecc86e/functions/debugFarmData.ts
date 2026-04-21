import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    console.log('=== Debug Farm Data ===');
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ 
                success: false,
                error: 'משתמש לא מחובר' 
            }, { status: 401 });
        }

        console.log('User:', user.email);
        console.log('User farm_ids:', user.farm_ids);
        console.log('Current farm:', user.current_farm_id);

        // Get ALL pallet types in the system (as service role)
        const allPalletTypes = await base44.asServiceRole.entities.PalletType.list();
        
        console.log('Total pallet types in system:', allPalletTypes.length);

        // Group by farm_id
        const byFarm = {};
        const noFarmId = [];
        
        for (const item of allPalletTypes) {
            if (!item.farm_id) {
                noFarmId.push(item);
            } else {
                if (!byFarm[item.farm_id]) {
                    byFarm[item.farm_id] = [];
                }
                byFarm[item.farm_id].push(item);
            }
        }

        // Get what the user sees with their current auth
        const userPalletTypes = await base44.entities.PalletType.list();
        console.log('User sees:', userPalletTypes.length, 'pallet types');

        // Get what filter returns for current farm
        let filteredPalletTypes = [];
        if (user.current_farm_id) {
            filteredPalletTypes = await base44.entities.PalletType.filter({ 
                farm_id: user.current_farm_id 
            });
            console.log('Filtered for farm', user.current_farm_id, ':', filteredPalletTypes.length);
        }

        return Response.json({
            success: true,
            user_email: user.email,
            user_id: user.id,
            current_farm_id: user.current_farm_id,
            farm_ids: user.farm_ids,
            total_count: allPalletTypes.length,
            user_sees_count: userPalletTypes.length,
            filtered_count: filteredPalletTypes.length,
            pallet_types_by_farm: Object.fromEntries(
                Object.entries(byFarm).map(([farmId, items]) => [
                    farmId,
                    items.map(item => ({
                        id: item.id,
                        name: item.name,
                        weight: item.weight,
                        created_by: item.created_by,
                        farm_id: item.farm_id
                    }))
                ])
            ),
            no_farm_id: noFarmId.map(item => ({
                id: item.id,
                name: item.name,
                weight: item.weight,
                created_by: item.created_by
            })),
            user_sees: userPalletTypes.map(item => ({
                id: item.id,
                name: item.name,
                farm_id: item.farm_id,
                created_by: item.created_by
            })),
            filtered: filteredPalletTypes.map(item => ({
                id: item.id,
                name: item.name,
                farm_id: item.farm_id,
                created_by: item.created_by
            }))
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ 
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});