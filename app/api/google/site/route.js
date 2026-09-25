import { NextResponse } from 'next/server';
import { ensureSchema, getSql } from '../../../../lib/db';
export async function POST(req){
  try{
    const {client,siteUrl}=await req.json();
    if(!client||!siteUrl) return NextResponse.json({error:'Client and property are required'},{status:400});
    await ensureSchema(); const sql=getSql();
    await sql`UPDATE client_integrations SET gsc_site_url=${siteUrl},updated_at=NOW() WHERE client_id=${client}`;
    return NextResponse.json({ok:true});
  }catch(e){return NextResponse.json({error:e.message},{status:500})}
}