import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    console.log('=== Testing Data Separation ===');
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ 
                success: false,
                error: 'User not authenticated' 
            }, { status: 401 });
        }

        console.log('Testing for user:', user.email);
        console.log('Current farm:', user.current_farm_id);
        console.log('User farms:', user.farm_ids);

        // Test 1: What does the user see with their auth?
        const userSeesAll = await base44.entities.PalletType.list();
        
        // Test 2: What does filter return?
        const userSeesFiltered = user.current_farm_id 
            ? await base44.entities.PalletType.filter({ farm_id: user.current_farm_id })
            : [];

        // Test 3: What's actually in the database (as admin)?
        const allInDatabase = await base44.asServiceRole.entities.PalletType.list();

        // Group by farm_id
        const byFarm = {};
        const noFarmId = [];
        
        for (const item of allInDatabase) {
            if (!item.farm_id) {
                noFarmId.push(item);
            } else {
                if (!byFarm[item.farm_id]) {
                    byFarm[item.farm_id] = [];
                }
                byFarm[item.farm_id].push(item);
            }
        }

        const report = {
            success: true,
            timestamp: new Date().toISOString(),
            user: {
                email: user.email,
                id: user.id,
                current_farm_id: user.current_farm_id,
                farm_ids: user.farm_ids
            },
            tests: {
                '1_user_sees_with_list': {
                    count: userSeesAll.length,
                    items: userSeesAll.map(i => ({ 
                        id: i.id, 
                        name: i.name, 
                        farm_id: i.farm_id,
                        created_by: i.created_by 
                    }))
                },
                '2_user_sees_with_filter': {
                    count: userSeesFiltered.length,
                    items: userSeesFiltered.map(i => ({ 
                        id: i.id, 
                        name: i.name, 
                        farm_id: i.farm_id,
                        created_by: i.created_by 
                    }))
                },
                '3_all_in_database': {
                    total_count: allInDatabase.length,
                    by_farm: Object.fromEntries(
                        Object.entries(byFarm).map(([farmId, items]) => [
                            farmId,
                            {
                                count: items.length,
                                items: items.map(i => ({ 
                                    id: i.id, 
                                    name: i.name, 
                                    created_by: i.created_by 
                                }))
                            }
                        ])
                    ),
                    no_farm_id: {
                        count: noFarmId.length,
                        items: noFarmId.map(i => ({ 
                            id: i.id, 
                            name: i.name, 
                            created_by: i.created_by 
                        }))
                    }
                }
            },
            analysis: {
                issue_detected: userSeesAll.length > userSeesFiltered.length,
                user_should_only_see: user.current_farm_id ? byFarm[user.current_farm_id]?.length || 0 : 0,
                user_actually_sees: userSeesAll.length,
                data_leakage: userSeesAll.some(item => 
                    item.farm_id && item.farm_id !== user.current_farm_id
                )
            }
        };

        console.log('Report:', JSON.stringify(report, null, 2));

        return Response.json(report);

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ 
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});