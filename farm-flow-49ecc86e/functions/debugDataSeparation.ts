import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const report = {
            user_id: user.id,
            user_email: user.email,
            current_farm_id: user.current_farm_id,
            farm_ids: user.farm_ids || [],
            data_issues: []
        };

        // Check all entities that should have farm_id
        const entitiesToCheck = [
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
            'Expense',
            'Harvest',
            'Activity',
            'Spraying',
            'PlasticSheet',
            'WeighingCertificate',
            'WeighingItem',
            'Employee',
            'Vehicle',
            'VehicleTreatment',
            'CompanySettings',
            'Subscription'
        ];

        for (const entityName of entitiesToCheck) {
            try {
                const allRecords = await base44.asServiceRole.entities[entityName].list();
                
                // Count records without farm_id
                const noFarmId = allRecords.filter(r => !r.farm_id);
                
                // Group by farm_id
                const byFarm = {};
                allRecords.forEach(record => {
                    const farmId = record.farm_id || 'NO_FARM_ID';
                    if (!byFarm[farmId]) {
                        byFarm[farmId] = [];
                    }
                    byFarm[farmId].push(record.id);
                });

                report.data_issues.push({
                    entity: entityName,
                    total_records: allRecords.length,
                    records_without_farm_id: noFarmId.length,
                    distribution_by_farm: Object.keys(byFarm).map(farmId => ({
                        farm_id: farmId,
                        count: byFarm[farmId].length
                    }))
                });

            } catch (e) {
                report.data_issues.push({
                    entity: entityName,
                    error: e.message
                });
            }
        }

        return Response.json(report, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            }
        });

    } catch (error) {
        console.error('Debug error:', error);
        return Response.json({ 
            error: error.message 
        }, { 
            status: 500,
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            }
        });
    }
});