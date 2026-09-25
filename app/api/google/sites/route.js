import { NextResponse } from 'next/server';
import { gscFetch } from '../../../../lib/google';
export const dynamic='force-dynamic';
export async function GET(req){
  try{
    const client=req.nextUrl.searchParams.get('client');
    const d=await gscFetch(client,'https://www.googleapis.com/webmasters/v3/sites');
    return NextResponse.json({sites:(d.siteEntry||[]).filter(x=>x.permissionLevel!=='siteUnverifiedUser')});
  }catch(e){return NextResponse.json({error:e.message},{status:500})}
}