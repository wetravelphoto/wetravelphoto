import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { currentEditor } from '@/lib/auth'

/**
 * Every newsletter sign-up as a CSV file, for the photographer to import
 * anywhere. Editors of this site only; row-level security is the backstop.
 */
export async function GET() {
  const editor = await currentEditor()
  if (!editor) return new NextResponse('Not signed in.', { status: 401 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('newsletter_signups')
    .select('email, created_at, synced_at')
    .eq('tenant_id', editor.tenantId)
    .order('created_at', { ascending: true })

  if (error) return new NextResponse(error.message, { status: 500 })

  // Quoted, with any quote doubled; a leading = + - @ is prefixed so a
  // spreadsheet never runs a cell as a formula.
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
    return `"${safe.replace(/"/g, '""')}"`
  }
  const rows = [
    ['email', 'signed_up', 'sent_to_mailing_service'].map(cell).join(','),
    ...(data ?? []).map((r) => [r.email, r.created_at, r.synced_at ?? ''].map(cell).join(',')),
  ]

  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(rows.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="newsletter-signups-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
