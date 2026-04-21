import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    console.log('🚀 Import pesticides started');
    
    try {
        // Initialize SDK
        const base44 = createClientFromRequest(req);
        
        // Check auth
        try {
            const user = await base44.auth.me();
            if (!user) {
                return Response.json({ success: false, error: 'נדרשת הזדהות' }, { status: 401 });
            }
            console.log('✅ User authenticated:', user.email);
        } catch (e) {
            return Response.json({ success: false, error: 'נדרשת הזדהות למערכת' }, { status: 401 });
        }

        // Fetch from government API
        console.log('📡 Fetching from government API...');
        const apiUrl = 'https://data.gov.il/api/3/action/datastore_search';
        const resourceId = '46024a96-2dfc-4365-a102-10c337ee7827';
        
        const response = await fetch(`${apiUrl}?resource_id=${resourceId}&limit=100&offset=0`);
        
        if (!response.ok) {
            throw new Error('Government API failed');
        }

        const data = await response.json();
        
        if (!data.success || !data.result?.records) {
            throw new Error('Invalid API response');
        }

        console.log(`✅ Got ${data.result.records.length} records`);

        // Get existing pesticides
        const existing = await base44.asServiceRole.entities.Pesticide.list();
        const existingMap = new Map();
        existing.forEach(p => {
            if (p.registration_number) {
                existingMap.set(p.registration_number.trim(), p);
            }
        });

        let newCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        // Process each record
        for (const record of data.result.records) {
            try {
                const regNum = record['מספר רישיון']?.toString().trim();
                const name = record['שם תכשיר']?.trim();
                
                if (!regNum || !name) {
                    skippedCount++;
                    continue;
                }

                // Determine type
                let type = 'other';
                const activity = (record['סוג פעילות'] || '').toLowerCase();
                if (activity.includes('פטרי') || activity.includes('fungic')) {
                    type = 'fungicide';
                } else if (activity.includes('חרק') || activity.includes('insecti')) {
                    type = 'insecticide';
                } else if (activity.includes('עשב') || activity.includes('herbic')) {
                    type = 'herbicide';
                }

                const pesticideData = {
                    registration_number: regNum,
                    product_name: name,
                    product_type: type,
                    manufacturer: record['בעל רישיון'] || '',
                    active_ingredients: record['חומר פעיל'] || '',
                    concentration: record['ריכוז חומר פעיל'] || '',
                    crop: record['גידול'] || '',
                    pest: record['נגע'] || '',
                    dosage: record['מינון ליישום'] || '',
                    volume: record['נפח ליישום'] || '',
                    label_url: record['תווית'] || '',
                    waiting_period: record['תקופת המתנה'] || ''
                };

                const existingPesticide = existingMap.get(regNum);

                if (existingPesticide) {
                    // Update missing fields only
                    const updates = {};
                    for (const [key, value] of Object.entries(pesticideData)) {
                        if (key !== 'registration_number' && value && 
                            (!existingPesticide[key] || !existingPesticide[key].toString().trim())) {
                            updates[key] = value;
                        }
                    }

                    if (Object.keys(updates).length > 0) {
                        await base44.asServiceRole.entities.Pesticide.update(existingPesticide.id, updates);
                        updatedCount++;
                    } else {
                        skippedCount++;
                    }
                } else {
                    // Create new
                    await base44.asServiceRole.entities.Pesticide.create(pesticideData);
                    newCount++;
                }

            } catch (err) {
                console.error('Record error:', err.message);
                skippedCount++;
            }
        }

        console.log(`✅ Done: ${newCount} new, ${updatedCount} updated, ${skippedCount} skipped`);

        return Response.json({
            success: true,
            message: `הושלם! ${newCount} חדשים, ${updatedCount} עודכנו, ${skippedCount} דולגו`,
            stats: { new: newCount, updated: updatedCount, skipped: skippedCount }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({
            success: false,
            error: error.message || 'הייבוא נכשל'
        }, { status: 500 });
    }
});