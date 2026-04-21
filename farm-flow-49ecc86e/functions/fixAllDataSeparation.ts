import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    console.log('=== Fixing All Data Separation ===');
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user || !user.current_farm_id) {
            return Response.json({ 
                success: false,
                error: 'משתמש לא מחובר או אין משק פעיל' 
            }, { status: 401 });
        }

        const farmId = user.current_farm_id;
        console.log('Fixing data for farm:', farmId);

        const results = {
            fixed: {},
            errors: []
        };

        // List of entities to fix
        const entities = [
            'Plot', 'Seeding', 'Harvest', 'Activity', 'Spraying', 
            'Expense', 'WeighingCertificate', 'WeighingItem',
            'Customer', 'CustomerProductPricing', 'Product',
            'Packaging', 'PalletType', 'Crop', 'InputType', 
            'ActivityType', 'SheetType', 'PlasticSheet',
            'Employee', 'ManpowerCompany', 'CompanySettings',
            'Vehicle', 'VehicleTreatment', 'PlotSeeding'
        ];

        for (const entityName of entities) {
            try {
                console.log(`Processing ${entityName}...`);
                
                // Get all records for this entity that belong to current user
                const allRecords = await base44.asServiceRole.entities[entityName].list();
                
                let fixedCount = 0;
                
                for (const record of allRecords) {
                    // Skip if already has farm_id
                    if (record.farm_id) continue;
                    
                    // Skip if has created_by that doesn't match current user
                    if (record.created_by && record.created_by !== user.email) continue;
                    
                    try {
                        // Update with farm_id
                        await base44.asServiceRole.entities[entityName].update(record.id, {
                            farm_id: farmId
                        });
                        fixedCount++;
                    } catch (updateError) {
                        console.error(`Failed to update ${entityName} ${record.id}:`, updateError);
                    }
                }
                
                if (fixedCount > 0) {
                    results.fixed[entityName] = fixedCount;
                    console.log(`✓ Fixed ${fixedCount} ${entityName} records`);
                }
                
            } catch (error) {
                console.error(`Error processing ${entityName}:`, error);
                results.errors.push(`${entityName}: ${error.message}`);
            }
        }

        return Response.json({
            success: true,
            message: 'תיקון הפרדת הנתונים הושלם',
            farm_id: farmId,
            details: results
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});