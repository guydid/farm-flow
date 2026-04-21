import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    console.log('=== Cleaning User Farms ===');
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ 
                success: false,
                error: 'משתמש לא מחובר' 
            }, { status: 401 });
        }

        console.log('Current user farm_ids:', user.farm_ids);
        console.log('Current farm_id:', user.current_farm_id);

        // Get all farms and check which ones actually exist
        const validFarmIds = [];
        const invalidFarmIds = [];

        if (user.farm_ids && Array.isArray(user.farm_ids)) {
            for (const farmId of user.farm_ids) {
                try {
                    const farm = await base44.asServiceRole.entities.Farm.get(farmId);
                    if (farm) {
                        validFarmIds.push(farmId);
                        console.log(`✓ Farm ${farmId} exists: ${farm.name}`);
                    }
                } catch (error) {
                    console.log(`✗ Farm ${farmId} does NOT exist`);
                    invalidFarmIds.push(farmId);
                }
            }
        }

        // Update user with only valid farm_ids
        const updateData = {
            farm_ids: validFarmIds
        };

        // If current_farm_id is invalid, set to first valid or null
        if (!validFarmIds.includes(user.current_farm_id)) {
            updateData.current_farm_id = validFarmIds.length > 0 ? validFarmIds[0] : null;
            console.log('Updated current_farm_id to:', updateData.current_farm_id);
        }

        await base44.asServiceRole.entities.User.update(user.id, updateData);

        return Response.json({
            success: true,
            message: 'פרטי המשתמש נוקו בהצלחה',
            details: {
                valid_farms: validFarmIds,
                removed_farms: invalidFarmIds,
                new_current_farm: updateData.current_farm_id
            }
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});