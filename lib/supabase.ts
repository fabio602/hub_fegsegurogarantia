
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://hfjvwibucplyhsvnwfor.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmanZ3aWJ1Y3BseWhzdm53Zm9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzODA4NTIsImV4cCI6MjA4Nzk1Njg1Mn0.jCBS1YnDcKuVzJSVhGiJM0kyafPMZxFi52kszTJCxZQ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

