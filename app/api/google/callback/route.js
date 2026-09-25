import { NextResponse } from 'next/server';
import { ensureSchema, getSql } from '../../../../lib/db';
import { encrypt, verifyState } from '../../../../lib/google';

export async function GET(req){
  try{
    const code=req.nextUrl.searchParams.get('code');
    const clientId=verifyState(req.nextUrl.searchParams.get('state'));
    if(!code||!clientId) throw new Error('Invalid Google authorization response');
    const redirectUri=process.env.GOOGLE_OAUTH_REDIRECT_URI || new URL('/api/google/callback',req.url).toString();
    const body=new URLSearchParams({
      code,
      client_id:process.env.GOOGLE_OAUTH_CLIENT_ID||'',
      client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET||'',
      redirect_uri:redirectUri,
      grant_type:'authorization_code'
    });
    const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,cache:'no-store'});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error_description||d.error||'Google token exchange failed');
    if(!d.refresh_token) throw new Error('Google did not return a refresh token. Reconnect and approve access again.');
    await ensureSchema();
    const sql=getSql();
    await sql`INSERT INTO client_integrations(client_id,google_refresh_token_enc,google_connected_at,updated_at)
      VALUES (${clientId},${encrypt(d.refresh_token)},NOW(),NOW())
      ON CONFLICT(client_id) DO UPDATE SET google_refresh_token_enc=EXCLUDED.google_refresh_token_enc,google_connected_at=NOW(),updated_at=NOW()`;
    return NextResponse.redirect(new URL('/?client='+encodeURIComponent(clientId)+'&google=connected',req.url));
  }catch(e){
    return NextResponse.redirect(new URL('/?google=error&message='+encodeURIComponent(e.message),req.url));
  }
}