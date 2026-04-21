import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Verify admin user
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const TARGET_FARM_ID = '91'; // משק 91
        const results = {
            success: [],
            errors: [],
            summary: {}
        };

        // List of all entity types to migrate
        const entityTypes = [
            'Variety',
            'Crop', 
            'ActivityType',
            'InputType',
            'PalletType',
            'SheetType',
            'Product',
            'Customer',
            'Packaging',
            'ManpowerCompany',
            'CompanySettings',
            'Plot',
            'PlotSeeding',
            'Seeding',
            'Employee',
            'PlasticSheet',
            'WeighingCertificate',
            'WeighingItem',
            'Subscription',
            'Payment',
            'Vehicle',
            'VehicleTreatment',
            'Expense',
            'Harvest',
            'Spraying',
            'Activity',
            'CustomerProductPricing',
            'EmployeeLog'
        ];

        console.log('Starting migration to farm:', TARGET_FARM_ID);

        for (const entityType of entityTypes) {
            try {
                console.log(`Processing ${entityType}...`);
                
                // Get all records of this type
                const allRecords = await base44.asServiceRole.entities[entityType].list();
                
                if (!allRecords || allRecords.length === 0) {
                    results.summary[entityType] = { total: 0, updated: 0 };
                    continue;
                }

                let updated = 0;
                
                for (const record of allRecords) {
                    try {
                        // Skip if already has farm_id = 91
                        if (record.farm_id === TARGET_FARM_ID) {
                            continue;
                        }

                        // Update record with farm_id
                        await base44.asServiceRole.entities[entityType].update(record.id, {
                            ...record,
                            farm_id: TARGET_FARM_ID
                        });
                        
                        updated++;
                    } catch (updateError) {
                        console.error(`Error updating ${entityType} record ${record.id}:`, updateError);
                        results.errors.push({
                            entity: entityType,
                            recordId: record.id,
                            error: updateError.message
                        });
                    }
                }

                results.summary[entityType] = {
                    total: allRecords.length,
                    updated: updated
                };
                
                results.success.push(`${entityType}: ${updated}/${allRecords.length} records updated`);
                
            } catch (entityError) {
                console.error(`Error processing ${entityType}:`, entityError);
                results.errors.push({
                    entity: entityType,
                    error: entityError.message
                });
            }
        }

        console.log('Migration completed');
        console.log('Summary:', results.summary);
        console.log('Errors:', results.errors);

        return Response.json({
            status: 'completed',
            results: results,
            message: `Migration completed. Check summary for details.`
        });

    } catch (error) {
        console.error('Migration failed:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});