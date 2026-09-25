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
const metric=(row={})=>({clicks:Number(row.clicks||0),impressions:Number(row.impressions||0),ctr:Number(row.ctr||0),position:Number(row.position||0)});
const delta=(now,prev)=>prev===0?(now===0?0:null):((now-prev)/prev)*100;
function recommendations(queries,pages){
  const out=[];
  for(const r of queries||[]){
    const q=r.keys?.[0]||'';
    if(r.impressions>=20 && r.position>=11 && r.position<=20) out.push({priority:'High',category:'Keyword opportunity',title:'Move “'+q+'” onto page 1',reason:'This query has '+Math.round(r.impressions)+' impressions and an average position of '+Number(r.position).toFixed(1)+'.',action:'Strengthen the most relevant page with clearer topic coverage, internal links, and matching headings.'});
    if(r.impressions>=25 && r.ctr<0.03 && r.position<=15) out.push({priority:'Medium',category:'CTR opportunity',title:'Improve search snippet for “'+q+'”',reason:'This query is visible but CTR is '+(r.ctr*100).toFixed(1)+'%.',action:'Review the title and meta description on the ranking page for a clearer service/value proposition.'});
  }
  for(const r of pages||[]){
    const page=r.keys?.[0]||'';
    if(r.impressions>=30 && r.ctr<0.025) out.push({priority:'Medium',category:'Page CTR',title:'Improve CTR for a high-impression page',reason:page+' has '+Math.round(r.impressions)+' impressions with '+(r.ctr*100).toFixed(1)+'% CTR.',action:'Review its title, meta description, and search-intent alignment.'});
  }
  return out.slice(0,8);
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
    const prevEnd=new Date(start); prevEnd.setUTCDate(prevEnd.getUTCDate()-1);
    const prevStart=new Date(prevEnd); prevStart.setUTCDate(prevStart.getUTCDate()-days+1);
    const base={startDate:iso(start),endDate:iso(end),dataState:'final'};
    const prevBase={startDate:iso(prevStart),endDate:iso(prevEnd),dataState:'final'};

    const [sum,q,p,daily,prevSum]=await Promise.all([
      query(client,siteUrl,{...base,rowLimit:1}),
      query(client,siteUrl,{...base,dimensions:['query'],rowLimit:25}),
      query(client,siteUrl,{...base,dimensions:['page'],rowLimit:25}),
      query(client,siteUrl,{...base,dimensions:['date'],rowLimit:100}),
      query(client,siteUrl,{...prevBase,rowLimit:1})
    ]);
    const current=metric(sum.rows?.[0]);
    const previous=metric(prevSum.rows?.[0]);
    const comparison={
      clicks:delta(current.clicks,previous.clicks),
      impressions:delta(current.impressions,previous.impressions),
      ctr:delta(current.ctr,previous.ctr),
      position:previous.position===0?null:current.position-previous.position
    };

    await sql`INSERT INTO gsc_snapshots(client_id,range_days,start_date,end_date,clicks,impressions,ctr,position)
      VALUES(${client},${days},${base.startDate},${base.endDate},${current.clicks},${current.impressions},${current.ctr},${current.position})
      ON CONFLICT(client_id,range_days,end_date) DO UPDATE SET clicks=EXCLUDED.clicks,impressions=EXCLUDED.impressions,ctr=EXCLUDED.ctr,position=EXCLUDED.position,captured_at=NOW()`;

    const history=await sql`SELECT range_days,start_date,end_date,clicks,impressions,ctr,position,captured_at
      FROM gsc_snapshots WHERE client_id=${client} ORDER BY captured_at DESC LIMIT 20`;

    return NextResponse.json({
      siteUrl,days,startDate:base.startDate,endDate:base.endDate,
      previousStartDate:prevBase.startDate,previousEndDate:prevBase.endDate,
      summary:current,previous,comparison,
      queries:q.rows||[],pages:p.rows||[],daily:daily.rows||[],
      recommendations:recommendations(q.rows||[],p.rows||[]),
      history
    });
  }catch(e){return NextResponse.json({error:e.message},{status:500})}
}