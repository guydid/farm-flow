import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    console.log('=== Starting Full Data Migration ===');
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ 
                success: false,
                error: 'משתמש לא מחובר' 
            }, { status: 401 });
        }

        if (!user.current_farm_id) {
            return Response.json({ 
                success: false,
                error: 'לא נמצא משק פעיל למשתמש' 
            }, { status: 400 });
        }

        const targetFarmId = user.current_farm_id;
        console.log('Target farm ID:', targetFarmId);

        const results = {
            updated: {},
            errors: []
        };

        // List of entities to migrate
        const entitiesToMigrate = [
            'Crop',
            'Variety', 
            'ActivityType',
            'InputType',
            'PalletType',
            'SheetType',
            'Packaging',
            'Product',
            'Customer',
            'ManpowerCompany',
            'Plot',
            'Seeding',
            'Harvest',
            'Activity',
            'Spraying',
            'PlasticSheet',
            'WeighingCertificate',
            'WeighingItem',
            'Employee',
            'Vehicle',
            'CompanySettings'
        ];

        for (const entityName of entitiesToMigrate) {
            try {
                console.log(`\n--- Processing ${entityName} ---`);
                const allRecords = await base44.asServiceRole.entities[entityName].list();
                
                let updatedCount = 0;
                
                for (const record of allRecords) {
                    let needsUpdate = false;
                    
                    // Case 1: farm_id is "91" (wrong value)
                    if (record.farm_id === "91" || record.farm_id === 91) {
                        console.log(`${entityName} ${record.id}: farm_id="91" -> "${targetFarmId}"`);
                        needsUpdate = true;
                    }
                    // Case 2: No farm_id at all
                    else if (!record.farm_id) {
                        console.log(`${entityName} ${record.id}: NO farm_id -> "${targetFarmId}"`);
                        needsUpdate = true;
                    }
                    
                    if (needsUpdate) {
                        await base44.asServiceRole.entities[entityName].update(record.id, {
                            farm_id: targetFarmId
                        });
                        updatedCount++;
                    }
                }
                
                results.updated[entityName] = updatedCount;
                console.log(`${entityName}: Updated ${updatedCount} records`);
                
            } catch (error) {
                console.error(`Error processing ${entityName}:`, error.message);
                results.errors.push({
                    entity: entityName,
                    error: error.message
                });
            }
        }

        console.log('\n=== Migration Complete ===');
        console.log('Results:', JSON.stringify(results, null, 2));

        return Response.json({
            success: true,
            target_farm_id: targetFarmId,
            results: results
        }, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            }
        });

    } catch (error) {
        console.error('Migration error:', error);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { 
            status: 500,
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            }
        });
    }
});