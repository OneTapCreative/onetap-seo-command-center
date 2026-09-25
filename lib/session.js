import crypto from 'node:crypto';

export const COOKIE_NAME='onetap_session';

function secret(){
  const value=process.env.SESSION_SECRET;
  if(!value) throw new Error('SESSION_SECRET is not configured');
  return value;
}
export function sessionToken(){
  return crypto.createHmac('sha256',secret()).update('onetap-admin').digest('base64url');
}
export function validPassword(input){
  const expected=process.env.ADMIN_PASSWORD;
  if(!expected) throw new Error('ADMIN_PASSWORD is not configured');
  const a=Buffer.from(String(input||'')),b=Buffer.from(expected);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
export function sessionConfigured(){
  return !!(process.env.ADMIN_PASSWORD&&process.env.SESSION_SECRET);
}