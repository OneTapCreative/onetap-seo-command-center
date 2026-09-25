import { NextResponse } from 'next/server';
import { ensureSchema, getSql } from '../../../lib/db';

export const dynamic='force-dynamic';

export async function GET(req){
  try{
    await ensureSchema();
    const sql=getSql();
    const client=req.nextUrl.searchParams.get('client');
    const tasks=await sql`SELECT id,audit_id,check_id,label,evidence,status,notes,created_at,updated_at
      FROM technical_fix_tasks WHERE client_id=${client} ORDER BY updated_at DESC`;
    return NextResponse.json({tasks});
  }catch(e){return NextResponse.json({error:e.message},{status:500})}
}

export async function POST(req){
  try{
    await ensureSchema();
    const sql=getSql();
    const b=await req.json();
    if(b.action==='start'){
      const rows=await sql`INSERT INTO technical_fix_tasks(client_id,audit_id,check_id,label,evidence,status)
        VALUES(${b.client},${Number(b.auditId)},${b.check.id},${b.check.label},${b.check.evidence||''},'in_progress')
        RETURNING id,audit_id,check_id,label,evidence,status,notes,created_at,updated_at`;
      return NextResponse.json({task:rows[0]});
    }
    if(b.action==='complete'){
      const rows=await sql`UPDATE technical_fix_tasks SET status='completed',updated_at=NOW()
        WHERE id=${Number(b.taskId)} RETURNING id,audit_id,check_id,label,evidence,status,notes,created_at,updated_at`;
      return NextResponse.json({task:rows[0]});
    }
    if(b.action==='dismiss'){
      const rows=await sql`UPDATE technical_fix_tasks SET status='dismissed',updated_at=NOW()
        WHERE id=${Number(b.taskId)} RETURNING id,audit_id,check_id,label,evidence,status,notes,created_at,updated_at`;
      return NextResponse.json({task:rows[0]});
    }
    return NextResponse.json({error:'Unknown action'},{status:400});
  }catch(e){return NextResponse.json({error:e.message},{status:500})}
}