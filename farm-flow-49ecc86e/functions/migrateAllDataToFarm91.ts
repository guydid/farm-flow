import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Verify authentication
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized - Please login first' }, { status: 401 });
        }

        console.log('Migration started by user:', user.email);

        const TARGET_FARM_ID = '91'; // משק 91
        const results = {
            updated: {},
            errors: []
        };

        // List of entities to migrate with farm_id
        const farmEntities = [
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

        console.log(`Starting migration to farm ${TARGET_FARM_ID}...`);

        for (const entityName of farmEntities) {
            try {
                console.log(`\nProcessing ${entityName}...`);
                
                // Get all records
                const allRecords = await base44.asServiceRole.entities[entityName].list();
                
                if (!allRecords || allRecords.length === 0) {
                    console.log(`${entityName}: No records found`);
                    results.updated[entityName] = 0;
                    continue;
                }

                console.log(`${entityName}: Found ${allRecords.length} records`);
                let updated = 0;

                for (const record of allRecords) {
                    try {
                        // Skip if already belongs to target farm
                        if (record.farm_id === TARGET_FARM_ID) {
                            continue;
                        }

                        // Update with farm_id
                        await base44.asServiceRole.entities[entityName].update(record.id, {
                            farm_id: TARGET_FARM_ID
                        });
                        
                        updated++;
                    } catch (updateError) {
                        console.error(`Error updating ${entityName} ${record.id}:`, updateError.message);
                        results.errors.push({
                            entity: entityName,
                            recordId: record.id,
                            error: updateError.message
                        });
                    }
                }

                results.updated[entityName] = updated;
                console.log(`${entityName}: Updated ${updated} records`);
                
            } catch (entityError) {
                console.error(`Error processing ${entityName}:`, entityError.message);
                results.errors.push({
                    entity: entityName,
                    error: entityError.message
                });
                results.updated[entityName] = 0;
            }
        }

        const totalUpdated = Object.values(results.updated).reduce((sum, count) => sum + count, 0);

        console.log('\n=== Migration Complete ===');
        console.log('Total records updated:', totalUpdated);
        console.log('Errors:', results.errors.length);

        return Response.json({
            success: true,
            message: `Migration completed successfully! Updated ${totalUpdated} records.`,
            details: results.updated,
            errors: results.errors,
            totalUpdated: totalUpdated
        });

    } catch (error) {
        console.error('Migration failed:', error);
        return Response.json({ 
            success: false,
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});