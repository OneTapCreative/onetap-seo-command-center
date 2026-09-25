import { NextResponse } from 'next/server';
import { COOKIE_NAME, sessionToken, validPassword } from '../../../../lib/session';

export async function POST(req){
  try{
    const body=await req.json();
    if(!validPassword(body.password)) return NextResponse.json({error:'Invalid password'},{status:401});
    const res=NextResponse.json({ok:true});
    res.cookies.set(COOKIE_NAME,sessionToken(),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:60*60*12});
    return res;
  }catch(e){return NextResponse.json({error:e.message},{status:500})}
}