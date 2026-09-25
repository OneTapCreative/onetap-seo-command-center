import { NextResponse } from 'next/server';
import { googleConfigured, signState } from '../../../../lib/google';

export async function GET(req){
  if(!googleConfigured()) return NextResponse.redirect(new URL('/?google=config',req.url));
  const client=req.nextUrl.searchParams.get('client');
  if(!client) return NextResponse.json({error:'Missing client'},{status:400});
  const redirectUri=process.env.GOOGLE_OAUTH_REDIRECT_URI || new URL('/api/google/callback',req.url).toString();
  const p=new URLSearchParams({
    client_id:process.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri:redirectUri,
    response_type:'code',
    scope:'https://www.googleapis.com/auth/webmasters.readonly',
    access_type:'offline',
    include_granted_scopes:'true',
    prompt:'consent',
    state:signState(client)
  });
  return NextResponse.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+p.toString());
}