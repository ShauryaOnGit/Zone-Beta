import { createClient } from '@supabase/supabase-js';

// Same project you've already been using. Safe to keep in client code --
// Row Level Security on your tables is what actually controls access.
const SUPABASE_URL = 'https://htctwbmsjziessyddgxz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0Y3R3Ym1zanppZXNzeWRkZ3h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MTgzNzYsImV4cCI6MjA5ODM5NDM3Nn0.41joJtQsgHPQrccC7RHQv1f22CiSbHVldIV1gXHqVgM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);