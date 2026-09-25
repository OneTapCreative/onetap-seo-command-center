import { NextResponse } from 'next/server';
import net from 'node:net';
import { ensureSchema, getSql } from '../../../lib/db';

export const dynamic='force-dynamic';

function normalize(site){
  let s=String(site||'').trim();
  if(!s||s==='Not set'||s==='Client website') throw new Error('Set a real website URL for this client first');
  if(!/^https?:\/\//i.test(s)) s='https://'+s;
  const u=new URL(s);
  if(!['http:','https:'].includes(u.protocol)) throw new Error('Only HTTP/HTTPS websites can be audited');
  if(u.username||u.password) throw new Error('Credentials in URLs are not allowed');
  return u;
}
function blockedHost(host){
  const h=host.toLowerCase();
  if(h==='localhost'||h.endsWith('.local')) return true;
  const ip=net.isIP(h);
  if(ip===4){
    const p=h.split('.').map(Number);
    return p[0]===10||p[0]===127||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168);
  }
  return ip===6 && (h==='::1'||h.startsWith('fc')||h.startsWith('fd')||h.startsWith('fe80'));
}
async function getText(url){
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),12000);
  try{
    const r=await fetch(url,{redirect:'follow',signal:ctl.signal,headers:{'User-Agent':'OneTapSEOAudit/1.0'},cache:'no-store'});
    const text=await r.text();
    return {ok:r.ok,status:r.status,url:r.url,text:text.slice(0,1500000),type:r.headers.get('content-type')||''};
  }finally{clearTimeout(t)}
}
const pass=(id,label,evidence)=>({id,label,status:'healthy',evidence});
const warn=(id,label,evidence)=>({id,label,status:'needs_attention',evidence});
const fail=(id,label,evidence)=>({id,label,status:'action_required',evidence});

export async function GET(req){
  try{
    await ensureSchema();const sql=getSql();const client=req.nextUrl.searchParams.get('client');
    const rows=await sql`SELECT id,url,status,checks,summary,captured_at FROM technical_audits WHERE client_id=${client} ORDER BY captured_at DESC LIMIT 5`;
    return NextResponse.json({audits:rows});
  }catch(e){return NextResponse.json({error:e.message},{status:500})}
}
export async function POST(req){
  try{
    await ensureSchema();const sql=getSql();const {client}=await req.json();
    const cr=await sql`SELECT site FROM clients WHERE id=${client}`;if(!cr[0]) return NextResponse.json({error:'Client not found'},{status:404});
    const u=normalize(cr[0].site);if(blockedHost(u.hostname)) return NextResponse.json({error:'Private/local hosts cannot be audited'},{status:400});
    const home=await getText(u.toString());if(!home.ok) throw new Error('Homepage returned HTTP '+home.status);
    const html=home.text;
    const checks=[];
    checks.push(pass('https','HTTPS',home.url.startsWith('https://')?'Final URL uses HTTPS':''));
    const title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]?.replace(/\s+/g,' ').trim()||'';
    checks.push(!title?fail('title','Page title','No <title> found'):title.length<30||title.length>65?warn('title','Page title','Title length: '+title.length+' characters'):pass('title','Page title','Title length: '+title.length+' characters'));
    const desc=(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)||html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i)||[])[1]||'';
    checks.push(!desc?fail('meta','Meta description','No meta description found'):desc.length<70||desc.length>170?warn('meta','Meta description','Description length: '+desc.length+' characters'):pass('meta','Meta description','Description length: '+desc.length+' characters'));
    const h1=(html.match(/<h1\b/gi)||[]).length;
    checks.push(h1===1?pass('h1','H1 structure','Exactly one H1 found'):h1===0?fail('h1','H1 structure','No H1 found'):warn('h1','H1 structure',h1+' H1 elements found'));
    const canonical=/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i.test(html);
    checks.push(canonical?pass('canonical','Canonical tag','Canonical tag found'):warn('canonical','Canonical tag','No canonical tag detected'));
    const schema=(html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>/gi)||[]).length;
    checks.push(schema?pass('schema','Structured data',schema+' JSON-LD block'+(schema===1?'':'s')+' found'):warn('schema','Structured data','No JSON-LD structured data detected'));
    const imgs=[...html.matchAll(/<img\b[^>]*>/gi)].map(x=>x[0]);const missingAlt=imgs.filter(x=>!/\balt\s*=\s*["'][^"']*["']/i.test(x)).length;
    checks.push(missingAlt===0?pass('alt','Image alt attributes',imgs.length+' images checked'):warn('alt','Image alt attributes',missingAlt+' of '+imgs.length+' images missing alt attributes'));
    const base=new URL(home.url);
    const robots=await getText(new URL('/robots.txt',base).toString()).catch(()=>({ok:false,status:0,text:''}));
    checks.push(robots.ok?pass('robots','robots.txt','robots.txt returned HTTP '+robots.status):warn('robots','robots.txt','robots.txt not found or unavailable'));
    let sitemapUrl=new URL('/sitemap.xml',base).toString();
    const m=robots.text?.match(/sitemap:\s*(\S+)/i);if(m)sitemapUrl=m[1];
    const sitemap=await getText(sitemapUrl).catch(()=>({ok:false,status:0,text:''}));
    checks.push(sitemap.ok&&/<(urlset|sitemapindex)\b/i.test(sitemap.text)?pass('sitemap','XML sitemap','Valid sitemap detected'):warn('sitemap','XML sitemap','Sitemap not found or could not be validated'));
    let performance=null;
    if(process.env.PAGESPEED_API_KEY){
      const psi='https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url='+encodeURIComponent(home.url)+'&strategy=mobile&category=performance&key='+encodeURIComponent(process.env.PAGESPEED_API_KEY);
      const r=await fetch(psi,{cache:'no-store'});const d=await r.json().catch(()=>({}));
      if(r.ok){performance=Math.round((d.lighthouseResult?.categories?.performance?.score||0)*100);checks.push(performance>=90?pass('pagespeed','Mobile performance','PageSpeed score: '+performance):performance>=50?warn('pagespeed','Mobile performance','PageSpeed score: '+performance):fail('pagespeed','Mobile performance','PageSpeed score: '+performance))}
      else checks.push(warn('pagespeed','Mobile performance','PageSpeed API request failed'));
    }else checks.push(warn('pagespeed','Mobile performance','Add PAGESPEED_API_KEY to enable Lighthouse performance checks'));
    const counts={healthy:checks.filter(x=>x.status==='healthy').length,needs_attention:checks.filter(x=>x.status==='needs_attention').length,action_required:checks.filter(x=>x.status==='action_required').length};
    const status=counts.action_required?'action_required':counts.needs_attention?'needs_attention':'healthy';
    const summary={...counts,total:checks.length,performance};
    const saved=await sql`INSERT INTO technical_audits(client_id,url,status,checks,summary) VALUES(${client},${home.url},${status},${JSON.stringify(checks)}::jsonb,${JSON.stringify(summary)}::jsonb) RETURNING id,url,status,checks,summary,captured_at`;
    return NextResponse.json({audit:saved[0]});
  }catch(e){return NextResponse.json({error:e.message},{status:500})}
}