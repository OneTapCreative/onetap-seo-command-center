import { NextResponse } from 'next/server';
import { ensureSchema, getSql } from '../../../lib/db';
import { googleConfigured } from '../../../lib/google';

export const dynamic='force-dynamic';

async function state(){
  await ensureSchema();
  const sql=getSql();
  const clients=await sql`SELECT c.id,c.name,c.type,c.site,c.city,c.github_repo,
    (i.google_refresh_token_enc IS NOT NULL) AS gsc_connected,
    i.gsc_site_url
    FROM clients c LEFT JOIN client_integrations i ON i.client_id=c.id
    ORDER BY c.created_at`;
  const actions=await sql`SELECT id,title,priority,scope,completed FROM seo_actions ORDER BY id`;
  return {clients,actions,googleConfigured:googleConfigured()};
}

export async function GET(){
  try{return NextResponse.json(await state())}
  catch(e){return NextResponse.json({error:e.message},{status:500})}
}

export async function POST(req){
  try{
    await ensureSchema();
    const sql=getSql();
    const body=await req.json();
    if(body.kind==='client'){
      const name=String(body.name||'').trim();
      if(!name) return NextResponse.json({error:'Business name is required'},{status:400});
      const base=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'client';
      let id=base,n=2;
      while((await sql`SELECT 1 FROM clients WHERE id=${id}`).length){id=base+'-'+n++}
      await sql`INSERT INTO clients(id,name,type,site,city,github_repo) VALUES (${id},${name},${body.type||'Local Business'},${body.site||'Not set'},${body.city||'Not set'},${body.github_repo||null})`;
    }
    if(body.kind==='action') await sql`UPDATE seo_actions SET completed=${!!body.completed},updated_at=NOW() WHERE id=${Number(body.id)}`;
    if(body.kind==='delete_client'){
      const id=String(body.id||'').trim();
      if(!id) return NextResponse.json({error:'Client ID is required'},{status:400});
      const deleted=await sql`DELETE FROM clients WHERE id=${id} RETURNING id,name`;
      if(!deleted.length) return NextResponse.json({error:'Client not found'},{status:404});
    }
    return NextResponse.json(await state());
  }catch(e){return NextResponse.json({error:e.message},{status:500})}
}