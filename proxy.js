import { NextResponse } from 'next/server';

async function expected(secret){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('onetap-admin'));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function proxy(req){
  const path=req.nextUrl.pathname;
  if(path.startsWith('/_next/')||path==='/favicon.ico'||path==='/sign-in'||path==='/api/auth/login'||path==='/api/google/callback') return NextResponse.next();
  const secret=process.env.SESSION_SECRET;
  if(!secret){
    if(path.startsWith('/api/')) return NextResponse.json({error:'Admin authentication is not configured'},{status:503});
    const url=req.nextUrl.clone();url.pathname='/sign-in';url.searchParams.set('setup','1');return NextResponse.redirect(url);
  }
  const token=req.cookies.get('onetap_session')?.value;
  const ok=token && token===await expected(secret);
  if(ok) return NextResponse.next();
  if(path.startsWith('/api/')) return NextResponse.json({error:'Unauthorized'},{status:401});
  const url=req.nextUrl.clone();url.pathname='/sign-in';url.search='';return NextResponse.redirect(url);
}
export const config={matcher:['/((?!.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?|txt|xml)$).*)']};