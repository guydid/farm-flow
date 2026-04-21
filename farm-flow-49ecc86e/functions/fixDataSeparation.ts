import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    console.log('=== Starting Data Separation Fix ===');
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ 
                success: false,
                error: 'משתמש לא מחובר' 
            });
        }

        if (!user.current_farm_id) {
            return Response.json({ 
                success: false,
                error: 'לא נמצא משק פעיל למשתמש' 
            });
        }

        const farmId = user.current_farm_id;
        console.log('Fixing data for farm:', farmId);

        const results = {
            crops: 0,
            varieties: 0,
            activityTypes: 0,
            inputTypes: 0,
            palletTypes: 0,
            sheetTypes: 0,
            packaging: 0,
            products: 0,
            customers: 0,
            manpowerCompanies: 0
        };

        // Fix Crops
        try {
            const crops = await base44.asServiceRole.entities.Crop.list();
            for (const crop of crops) {
                if (!crop.farm_id) {
                    await base44.asServiceRole.entities.Crop.update(crop.id, { farm_id: farmId });
                    results.crops++;
                }
            }
            console.log('Fixed crops:', results.crops);
        } catch (e) {
            console.warn('Error fixing crops:', e.message);
        }

        // Fix Varieties
        try {
            const varieties = await base44.asServiceRole.entities.Variety.list();
            for (const variety of varieties) {
                if (!variety.farm_id) {
                    await base44.asServiceRole.entities.Variety.update(variety.id, { farm_id: farmId });
                    results.varieties++;
                }
            }
            console.log('Fixed varieties:', results.varieties);
        } catch (e) {
            console.warn('Error fixing varieties:', e.message);
        }

        // Fix Activity Types
        try {
            const activityTypes = await base44.asServiceRole.entities.ActivityType.list();
            for (const type of activityTypes) {
                if (!type.farm_id) {
                    await base44.asServiceRole.entities.ActivityType.update(type.id, { farm_id: farmId });
                    results.activityTypes++;
                }
            }
            console.log('Fixed activity types:', results.activityTypes);
        } catch (e) {
            console.warn('Error fixing activity types:', e.message);
        }

        // Fix Input Types
        try {
            const inputTypes = await base44.asServiceRole.entities.InputType.list();
            for (const type of inputTypes) {
                if (!type.farm_id) {
                    await base44.asServiceRole.entities.InputType.update(type.id, { farm_id: farmId });
                    results.inputTypes++;
                }
            }
            console.log('Fixed input types:', results.inputTypes);
        } catch (e) {
            console.warn('Error fixing input types:', e.message);
        }

        // Fix Pallet Types
        try {
            const palletTypes = await base44.asServiceRole.entities.PalletType.list();
            for (const type of palletTypes) {
                if (!type.farm_id) {
                    await base44.asServiceRole.entities.PalletType.update(type.id, { farm_id: farmId });
                    results.palletTypes++;
                }
            }
            console.log('Fixed pallet types:', results.palletTypes);
        } catch (e) {
            console.warn('Error fixing pallet types:', e.message);
        }

        // Fix Sheet Types
        try {
            const sheetTypes = await base44.asServiceRole.entities.SheetType.list();
            for (const type of sheetTypes) {
                if (!type.farm_id) {
                    await base44.asServiceRole.entities.SheetType.update(type.id, { farm_id: farmId });
                    results.sheetTypes++;
                }
            }
            console.log('Fixed sheet types:', results.sheetTypes);
        } catch (e) {
            console.warn('Error fixing sheet types:', e.message);
        }

        // Fix Packaging
        try {
            const packaging = await base44.asServiceRole.entities.Packaging.list();
            for (const pack of packaging) {
                if (!pack.farm_id) {
                    await base44.asServiceRole.entities.Packaging.update(pack.id, { farm_id: farmId });
                    results.packaging++;
                }
            }
            console.log('Fixed packaging:', results.packaging);
        } catch (e) {
            console.warn('Error fixing packaging:', e.message);
        }

        // Fix Products
        try {
            const products = await base44.asServiceRole.entities.Product.list();
            for (const product of products) {
                if (!product.farm_id) {
                    await base44.asServiceRole.entities.Product.update(product.id, { farm_id: farmId });
                    results.products++;
                }
            }
            console.log('Fixed products:', results.products);
        } catch (e) {
            console.warn('Error fixing products:', e.message);
        }

        // Fix Customers
        try {
            const customers = await base44.asServiceRole.entities.Customer.list();
            for (const customer of customers) {
                if (!customer.farm_id) {
                    await base44.asServiceRole.entities.Customer.update(customer.id, { farm_id: farmId });
                    results.customers++;
                }
            }
            console.log('Fixed customers:', results.customers);
        } catch (e) {
            console.warn('Error fixing customers:', e.message);
        }

        // Fix Manpower Companies
        try {
            const companies = await base44.asServiceRole.entities.ManpowerCompany.list();
            for (const company of companies) {
                if (!company.farm_id) {
                    await base44.asServiceRole.entities.ManpowerCompany.update(company.id, { farm_id: farmId });
                    results.manpowerCompanies++;
                }
            }
            console.log('Fixed manpower companies:', results.manpowerCompanies);
        } catch (e) {
            console.warn('Error fixing manpower companies:', e.message);
        }

        const total = Object.values(results).reduce((sum, val) => sum + val, 0);

        return Response.json({ 
            success: true,
            message: `תוקנו ${total} רשומות במשק ${farmId}`,
            details: results
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
        return Response.json({ 
            success: false,
            error: error.message
        });
    }
});