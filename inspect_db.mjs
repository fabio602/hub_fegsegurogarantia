import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://hfjvwibucplyhsvnwfor.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmanZ3aWJ1Y3BseWhzdm53Zm9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzODA4NTIsImV4cCI6MjA4Nzk1Njg1Mn0.jCBS1YnDcKuVzJSVhGiJM0kyafPMZxFi52kszTJCxZQ'
);

async function checkColumns() {
    const { data, error } = await supabase.from('insurers').select('*').limit(1);
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Columns:', Object.keys(data[0] || {}));
        console.log('Data:', data[0]);
    }
}

checkColumns();
