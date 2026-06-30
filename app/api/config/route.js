export async function GET() {
  return Response.json({
    waServerUrl:      process.env.WA_SERVER_URL      || '',
    waApiKey:         process.env.WA_API_KEY         || '',
    supabaseUrl:      process.env.SUPABASE_URL       || '',
    supabaseAnonKey:  process.env.SUPABASE_ANON_KEY  || ''
  });
}
