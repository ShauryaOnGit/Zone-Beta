import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://htctwbmsjziessyddgxz.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0Y3R3Ym1zanppZXNzeWRkZ3h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MTgzNzYsImV4cCI6MjA5ODM5NDM3Nn0.41joJtQsgHPQrccC7RHQv1f22CiSbHVldIV1gXHqVgM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
