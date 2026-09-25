import { NextResponse } from 'next/server';
import { ensureSchema, getSql } from '../../../lib/db';

export const dynamic='force-dynamic';

const SUPPORTED=new Set(['title','meta','canonical','robots','sitemap']);

function ghHeaders(){
  const token=process.env.GITHUB_TOKEN;
  if(!token) throw new Error('GITHUB_TOKEN is not configured in Vercel');
  return {Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
}
async function gh(repo,path,options={}){
  const r=await fetch('https://api.github.com/repos/'+repo+path,{...options,headers:{...ghHeaders(),...(options.headers||{})},cache:'no-store'});
  if(r.status===204)return null;
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.message||('GitHub request failed: '+r.status));
  return d;
}
async function file(repo,path,ref='main'){
  try{
    const d=await gh(repo,'/contents/'+path+'?ref='+encodeURIComponent(ref));
    return {exists:true,path,sha:d.sha,content:Buffer.from(d.content||'','base64').toString('utf8')};
  }catch(e){
    if(String(e.message).includes('Not Found')) return {exists:false,path,sha:null,content:''};
    throw e;
  }
}
async function putFile(repo,path,content,message,sha){
  const body={message,content:Buffer.from(content).toString('base64'),branch:'main'};
  if(sha)body.sha=sha;
  return gh(repo,'/contents/'+path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}
async function deleteFile(repo,path,sha,message){
  return gh(repo,'/contents/'+path,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,sha,branch:'main'})});
}
async function branchBackup(repo,label){
  const main=await gh(repo,'/git/ref/heads/main');
  const baseSha=main.object.sha;
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
  const safe=String(label||'fix').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,28)||'fix';
  const branch='onetap-backup/'+stamp+'-'+safe;
  await gh(repo,'/git/refs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:'refs/heads/'+branch,sha:baseSha})});
  return {branch,baseSha};
}
function siteUrl(site){
  const s=/^https?:\/\//i.test(site)?site:'https://'+site;
  const u=new URL(s); return u.origin+'/';
}
function titleText(c){return (c.name+' | '+c.type+' in '+c.city).slice(0,60)}
function descText(c){return ('Explore '+c.name+', '+c.type+' serving '+c.city+'. View services, business details, and contact information.').slice(0,155)}
function staticFix(check,src,c){
  const url=siteUrl(c.site);
  if(check==='title'){
    const val=titleText(c);
    if(/<title[^>]*>[\s\S]*?<\/title>/i.test(src)) return src.replace(/<title[^>]*>[\s\S]*?<\/title>/i,'<title>'+val+'</title>');
    return src.replace(/<head([^>]*)>/i,'<head$1>\n<title>'+val+'</title>');
  }
  if(check==='meta'){
    const val=descText(c).replace(/"/g,'&quot;');
    if(/<meta[^>]+name=["']description["'][^>]*>/i.test(src)) return src.replace(/<meta[^>]+name=["']description["'][^>]*>/i,'<meta name="description" content="'+val+'"/>');
    return src.replace(/<head([^>]*)>/i,'<head$1>\n<meta name="description" content="'+val+'"/>');
  }
  if(check==='canonical'){
    if(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i.test(src)) return src.replace(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i,'<link rel="canonical" href="'+url+'"/>');
    return src.replace(/<head([^>]*)>/i,'<head$1>\n<link rel="canonical" href="'+url+'"/>');
  }
  return src;
}
function nextMetadataFix(check,src,c){
  const url=siteUrl(c.site),t=titleText(c).replace(/'/g,"\\'"),d=descText(c).replace(/'/g,"\\'");
  if(check==='title'){
    if(/title\s*:\s*['"`][\s\S]*?['"`]/.test(src)) return src.replace(/title\s*:\s*['"`][\s\S]*?['"`]/,"title: '"+t+"'");
  }
  if(check==='meta'){
    if(/description\s*:\s*['"`][\s\S]*?['"`]/.test(src)) return src.replace(/description\s*:\s*['"`][\s\S]*?['"`]/,"description: '"+d+"'");
  }
  if(check==='canonical'){
    if(/alternates\s*:\s*\{[\s\S]*?canonical\s*:/m.test(src)) return src.replace(/canonical\s*:\s*['"`][\s\S]*?['"`]/,"canonical: '"+url+"'");
    const marker=/export\s+const\s+metadata[^=]*=\s*\{/;
    if(marker.test(src)) return src.replace(marker,m=>m+"\n  alternates: { canonical: '"+url+"' },");
  }
  throw new Error('This Next.js metadata file could not be safely updated automatically. Use the guided fix instead.');
}
async function planFix(repo,check,c){
  const pkg=await file(repo,'package.json');
  const isNext=pkg.exists && /"next"\s*:/.test(pkg.content);
  if(check==='robots'){
    if(isNext){
      const path='app/robots.ts';
      const current=await file(repo,path);
      const url=siteUrl(c.site);
      const content=`import type { MetadataRoute } from 'next';\n\nexport default function robots(): MetadataRoute.Robots {\n  return {\n    rules: { userAgent: '*', allow: '/' },\n    sitemap: '${url}sitemap.xml',\n  };\n}\n`;
      return [{...current,path,after:content}];
    }
    const current=await file(repo,'robots.txt');
    return [{...current,path:'robots.txt',after:'User-agent: *\nAllow: /\n\nSitemap: '+siteUrl(c.site)+'sitemap.xml\n'}];
  }
  if(check==='sitemap'){
    if(isNext){
      const path='app/sitemap.ts'; const current=await file(repo,path); const url=siteUrl(c.site);
      const content=`import type { MetadataRoute } from 'next';\n\nexport default function sitemap(): MetadataRoute.Sitemap {\n  return [{ url: '${url}', lastModified: new Date(), changeFrequency: 'monthly', priority: 1 }];\n}\n`;
      return [{...current,path,after:content}];
    }
    const current=await file(repo,'sitemap.xml'),url=siteUrl(c.site);
    return [{...current,path:'sitemap.xml',after:`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${url}</loc></url>\n</urlset>\n`}];
  }
  if(isNext){
    for(const path of ['app/layout.tsx','app/layout.jsx','app/layout.js','src/app/layout.tsx','src/app/layout.jsx','src/app/layout.js']){
      const current=await file(repo,path);
      if(current.exists)return [{...current,path,after:nextMetadataFix(check,current.content,c)}];
    }
    throw new Error('No Next.js layout metadata file was found for automatic repair.');
  }
  const current=await file(repo,'index.html');
  if(!current.exists)throw new Error('No supported homepage file was found for automatic repair.');
  return [{...current,path:'index.html',after:staticFix(check,current.content,c)}];
}

export async function GET(req){
  try{
    await ensureSchema();const sql=getSql();const client=req.nextUrl.searchParams.get('client');
    const backups=await sql`SELECT id,task_id,github_repo,backup_branch,base_sha,changed_paths,created_at,restored_at
      FROM technical_fix_backups WHERE client_id=${client} ORDER BY created_at DESC LIMIT 20`;
    return NextResponse.json({configured:!!process.env.GITHUB_TOKEN,backups});
  }catch(e){return NextResponse.json({error:e.message},{status:500})}
}

export async function POST(req){
  try{
    await ensureSchema();const sql=getSql();const b=await req.json();
    if(b.action==='apply'){
      if(!SUPPORTED.has(b.check?.id)) return NextResponse.json({error:'This issue requires a guided/manual fix. Automatic Apply Fix is limited to title, meta description, canonical, robots.txt, and sitemap.'},{status:400});
      const rows=await sql`SELECT id,name,type,site,city,github_repo FROM clients WHERE id=${b.client}`;
      const c=rows[0];if(!c) return NextResponse.json({error:'Client not found'},{status:404});
      if(!c.github_repo) return NextResponse.json({error:'Add a GitHub repo to this client profile before using Apply Fix'},{status:400});
      const taskRows=await sql`INSERT INTO technical_fix_tasks(client_id,audit_id,check_id,label,evidence,status)
        VALUES(${c.id},${Number(b.auditId)},${b.check.id},${b.check.label},${b.check.evidence||''},'in_progress') RETURNING id`;
      const taskId=taskRows[0].id;
      const plan=await planFix(c.github_repo,b.check.id,c);
      const backup=await branchBackup(c.github_repo,b.check.id);
      const paths=plan.map(x=>({path:x.path,existed:x.exists}));
      const backupRows=await sql`INSERT INTO technical_fix_backups(client_id,task_id,github_repo,backup_branch,base_sha,changed_paths)
        VALUES(${c.id},${taskId},${c.github_repo},${backup.branch},${backup.baseSha},${JSON.stringify(paths)}::jsonb) RETURNING id`;
      for(const f of plan){
        await putFile(c.github_repo,f.path,f.after,'OneTap SEO: fix '+b.check.label,f.sha);
      }
      await sql`UPDATE technical_fix_tasks SET status='applied',notes=${'Backup: '+backup.branch},updated_at=NOW() WHERE id=${taskId}`;
      return NextResponse.json({ok:true,taskId,backupId:backupRows[0].id,backupBranch:backup.branch,paths});
    }
    if(b.action==='restore'){
      const rows=await sql`SELECT * FROM technical_fix_backups WHERE id=${Number(b.backupId)}`;
      const rec=rows[0];if(!rec) return NextResponse.json({error:'Backup record not found'},{status:404});
      for(const item of rec.changed_paths||[]){
        const current=await file(rec.github_repo,item.path,'main');
        const backupFile=await file(rec.github_repo,item.path,rec.backup_branch);
        if(backupFile.exists){
          await putFile(rec.github_repo,item.path,backupFile.content,'OneTap SEO: restore '+item.path,current.sha);
        }else if(current.exists){
          await deleteFile(rec.github_repo,item.path,current.sha,'OneTap SEO: restore by removing '+item.path);
        }
      }
      await sql`UPDATE technical_fix_backups SET restored_at=NOW() WHERE id=${rec.id}`;
      if(rec.task_id) await sql`UPDATE technical_fix_tasks SET status='restored',updated_at=NOW() WHERE id=${rec.task_id}`;
      return NextResponse.json({ok:true});
    }
    return NextResponse.json({error:'Unknown action'},{status:400});
  }catch(e){return NextResponse.json({error:e.message},{status:500})}
}