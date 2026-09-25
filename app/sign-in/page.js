'use client';
import {useState} from 'react';
export default function SignIn(){
 const [password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const submit=async e=>{e.preventDefault();setBusy(true);setError('');try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Sign-in failed');location.href='/'}catch(e){setError(e.message)}finally{setBusy(false)}};
 return <div className="loginPage"><form className="loginCard" onSubmit={submit}><p className="eyebrow">ONETAP CREATIVE</p><h1>SEO Command Center</h1><p>Private admin access</p>{error&&<div className="loginError">{error}</div>}<label>Password<input type="password" autoFocus value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter admin password"/></label><button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form></div>
}