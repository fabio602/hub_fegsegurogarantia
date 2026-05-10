import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://hfjvwibucplyhsvnwfor.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmanZ3aWJ1Y3BseWhzdm53Zm9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzODA4NTIsImV4cCI6MjA4Nzk1Njg1Mn0.jCBS1YnDcKuVzJSVhGiJM0kyafPMZxFi52kszTJCxZQ'
);

const { error } = await supabase.from('insurers').select('id').limit(1);
console.log('insurers table:', error ? `MISSING - ${error.message}` : 'EXISTS');
