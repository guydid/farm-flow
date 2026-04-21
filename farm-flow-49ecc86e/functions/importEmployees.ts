import { createClientFromRequest } from 'npm:@base44/sdk@0.5.0';

// Helper to parse CSV simply
function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) return [];

    const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    
    return lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const entry = {};
        header.forEach((key, i) => {
            entry[key] = values[i];
        });
        return entry;
    });
}

// Helper to validate and format date strings
function formatDate(dateString) {
    if (!dateString) return null;
    try {
        const date = new Date(dateString);
        // Check if the date is valid
        if (isNaN(date.getTime())) return null;
        return date.toISOString().split('T')[0];
    } catch {
        return null;
    }
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || !user.current_farm_id) {
            return new Response(JSON.stringify({ success: false, error: "אימות נכשל או לא נבחר משק." }), { status: 401, headers: { "Content-Type": "application/json" } });
        }

        const { file_url } = await req.json();
        if (!file_url) {
            return new Response(JSON.stringify({ success: false, error: "לא סופק URL של קובץ." }), { status: 400, headers: { "Content-Type": "application/json" } });
        }

        const farm_id = user.current_farm_id;
        const fileResponse = await fetch(file_url);
        if (!fileResponse.ok) throw new Error("לא ניתן היה להוריד את הקובץ.");

        const csvText = await fileResponse.text();
        const records = parseCSV(csvText);

        const statusMap = {
            "פעיל": "active",
            "לא פעיל": "inactive",
            "בחופשה": "on_leave",
            "נטש": "abandoned",
            "בהליך אשרה": "inter_visa",
        };

        const employeesToCreate = [];
        let skippedCount = 0;

        for (const record of records) {
            const firstName = record["שם פרטי"];
            const lastName = record["שם משפחה"];

            if (!firstName || !lastName) {
                skippedCount++;
                continue;
            }

            const status = statusMap[record["סטטוס"]] || record["סטטוס"] || 'active';
            const startDate = formatDate(record["תאריך תחילת עבודה"]);

            if (!startDate) {
                skippedCount++;
                continue;
            }
            
            employeesToCreate.push({
                farm_id,
                first_name: firstName,
                last_name: lastName,
                full_name: `${firstName} ${lastName}`,
                status,
                start_date: startDate,
                nickname: record["כינוי"] || null,
                termination_date: formatDate(record["תאריך סיום העסקה"]),
                entry_date: formatDate(record["תאריך כניסה לארץ"]),
                country_of_origin: record["מדינת מוצא"] || null,
                passport_number: record["מספר דרכון"] || null,
                passport_expiry: formatDate(record["תוקף דרכון"]),
                visa_type: record["סוג אשרה"] || null,
                visa_expiry: formatDate(record["תוקף אשרה"]),
                notes: record["הערות"] || null,
            });
        }
        
        if (employeesToCreate.length > 0) {
            await base44.asServiceRole.entities.Employee.bulkCreate(employeesToCreate);
        }

        return new Response(JSON.stringify({
            success: true,
            imported: employeesToCreate.length,
            skipped: skippedCount,
        }), { status: 200, headers: { "Content-Type": "application/json" } });

    } catch (error) {
        console.error('Import employees error:', error);
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
});