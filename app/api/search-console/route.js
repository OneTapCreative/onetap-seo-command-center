import { NextResponse } from 'next/server';
import { ensureSchema, getSql } from '../../../lib/db';
import { gscFetch } from '../../../lib/google';

export const dynamic='force-dynamic';
const iso=d=>d.toISOString().slice(0,10);
async function query(client,siteUrl,body){
  return gscFetch(client,'https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(siteUrl)+'/searchAnalytics/query',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
  });
}
export async function GET(req){
  try{
    const client=req.nextUrl.searchParams.get('client');
    const days=Math.min(90,Math.max(7,Number(req.nextUrl.searchParams.get('days')||28)));
    await ensureSchema(); const sql=getSql();
    const rows=await sql`SELECT gsc_site_url FROM client_integrations WHERE client_id=${client}`;
    const siteUrl=rows[0]?.gsc_site_url;
    if(!siteUrl) return NextResponse.json({error:'Choose a Search Console property first'},{status:400});
    const end=new Date(); end.setUTCDate(end.getUTCDate()-2);
    const start=new Date(end); start.setUTCDate(start.getUTCDate()-days+1);
    const base={startDate:iso(start),endDate:iso(end),dataState:'final'};
    const [sum,q,p,daily]=await Promise.all([
      query(client,siteUrl,{...base,rowLimit:1}),
      query(client,siteUrl,{...base,dimensions:['query'],rowLimit:25}),
      query(client,siteUrl,{...base,dimensions:['page'],rowLimit:25}),
      query(client,siteUrl,{...base,dimensions:['date'],rowLimit:100})
    ]);
    const s=sum.rows?.[0]||{clicks:0,impressions:0,ctr:0,position:0};
    return NextResponse.json({siteUrl,days,startDate:base.startDate,endDate:base.endDate,summary:s,queries:q.rows||[],pages:p.rows||[],daily:daily.rows||[]});
  }catch(e){return NextResponse.json({error:e.message},{status:500})}
}