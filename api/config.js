export default function handler(request, response) {
  response.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
    supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
  });
}
