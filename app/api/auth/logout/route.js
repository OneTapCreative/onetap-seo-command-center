import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '../../../../lib/session';
export async function POST(req){
  const res=NextResponse.json({ok:true});
  res.cookies.set(COOKIE_NAME,'',{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:0});
  return res;
}