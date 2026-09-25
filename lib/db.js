import { neon } from '@neondatabase/serverless';

let _sql;
export function getSql(){
  const url=process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if(!url) throw new Error('DATABASE_URL is not configured');
  if(!_sql) _sql=neon(url);
  return _sql;
}

export async function ensureSchema(){
  const sql=getSql();
  await sql`CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Local Business',
    site TEXT NOT NULL DEFAULT 'Not set',
    city TEXT NOT NULL DEFAULT 'Not set',
    github_repo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS github_repo TEXT`;
  await sql`CREATE TABLE IF NOT EXISTS seo_actions (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL UNIQUE,
    priority TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'Both clients',
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS client_integrations (
    client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
    google_refresh_token_enc TEXT,
    gsc_site_url TEXT,
    google_connected_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS gsc_snapshots (
    id BIGSERIAL PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    range_days INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    clicks DOUBLE PRECISION NOT NULL DEFAULT 0,
    impressions DOUBLE PRECISION NOT NULL DEFAULT 0,
    ctr DOUBLE PRECISION NOT NULL DEFAULT 0,
    position DOUBLE PRECISION NOT NULL DEFAULT 0,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(client_id,range_days,end_date)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS technical_audits (
    id BIGSERIAL PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    status TEXT NOT NULL,
    checks JSONB NOT NULL,
    summary JSONB NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS technical_fix_tasks (
    id BIGSERIAL PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    audit_id BIGINT REFERENCES technical_audits(id) ON DELETE CASCADE,
    check_id TEXT NOT NULL,
    label TEXT NOT NULL,
    evidence TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`UPDATE clients SET github_repo='OneTapCreative/dj-jrv' WHERE id='dj-jrv' AND github_repo IS NULL`;
  await sql`UPDATE clients SET github_repo='OneTapCreative/Freda-modern-barber-website' WHERE id='freda' AND github_repo IS NULL`;
  const count=await sql`SELECT COUNT(*)::int AS n FROM clients`;
  if(count[0].n===0){
    await sql`INSERT INTO clients(id,name,type,site,city) VALUES
      ('dj-jrv','DJ JRV','DJ / Entertainment','dj-jrv.com','Stockton, CA'),
      ('freda','Freda the Barber','Barber / Local Service','Client website','Stockton, CA')
      ON CONFLICT DO NOTHING`;
  }
  const ac=await sql`SELECT COUNT(*)::int AS n FROM seo_actions`;
  if(ac[0].n===0){
    await sql`INSERT INTO seo_actions(title,priority,scope) VALUES
      ('Connect Search Console','High','Both clients'),
      ('Capture 28-day SEO baseline','High','Both clients'),
      ('Validate sitemap + schema','Medium','Both clients'),
      ('Add Google Business Profile metrics','Medium','Both clients')
      ON CONFLICT(title) DO NOTHING`;
  }
}