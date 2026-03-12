import { supabase } from './lib/supabase.js';

async function checkColumns() {
    try {
        const { data, error } = await supabase.from('prospects').select('*').limit(1);
        if (error) {
            console.error('Error:', error.message);
            return;
        }
        if (data && data.length > 0) {
            console.log('Columns:', Object.keys(data[0]).join(', '));
        } else {
            console.log('No data to inspect columns.');
        }
    } catch (e) {
        console.error('Script error:', e.message);
    }
}

checkColumns();
