import crypto from 'node:crypto';
import { getSql, ensureSchema } from './db';

function secretKey(){
  const secret=process.env.TOKEN_ENCRYPTION_KEY;
  if(!secret) throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
  return crypto.createHash('sha256').update(secret).digest();
}
export function googleConfigured(){
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.TOKEN_ENCRYPTION_KEY);
}
export function encrypt(value){
  const iv=crypto.randomBytes(12), key=secretKey();
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return [iv.toString('base64url'),tag.toString('base64url'),ciphertext.toString('base64url')].join('.');
}
export function decrypt(value){
  const [ivB,tagB,dataB]=value.split('.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',secretKey(),Buffer.from(ivB,'base64url'));
  decipher.setAuthTag(Buffer.from(tagB,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB,'base64url')),decipher.final()]).toString('utf8');
}
export function signState(clientId){
  const sig=crypto.createHmac('sha256',secretKey()).update(clientId).digest('base64url');
  return Buffer.from(clientId).toString('base64url')+'.'+sig;
}
export function verifyState(state){
  const [raw,sig]=String(state||'').split('.');
  if(!raw||!sig) return null;
  const clientId=Buffer.from(raw,'base64url').toString('utf8');
  const expected=crypto.createHmac('sha256',secretKey()).update(clientId).digest('base64url');
  if(sig.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return null;
  return clientId;
}
export async function refreshAccessToken(clientId){
  await ensureSchema();
  const sql=getSql();
  const rows=await sql`SELECT google_refresh_token_enc FROM client_integrations WHERE client_id=${clientId}`;
  if(!rows[0]?.google_refresh_token_enc) throw new Error('Search Console is not connected for this client');
  const refresh_token=decrypt(rows[0].google_refresh_token_enc);
  const body=new URLSearchParams({
    client_id:process.env.GOOGLE_OAUTH_CLIENT_ID||'',
    client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET||'',
    refresh_token,
    grant_type:'refresh_token'
  });
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,cache:'no-store'});
  const d=await r.json();
  if(!r.ok) throw new Error(d.error_description||d.error||'Unable to refresh Google access token');
  return d.access_token;
}
export async function gscFetch(clientId,url,options={}){
  const token=await refreshAccessToken(clientId);
  const r=await fetch(url,{...options,headers:{...(options.headers||{}),Authorization:'Bearer '+token},cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error?.message||'Google Search Console request failed');
  return d;
}