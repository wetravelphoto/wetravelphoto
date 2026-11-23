import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderProof, type ProofRpc } from '@/lib/photos/editor-proof'
import { LibraryError, type LibraryDb } from '@/lib/photos/library'

/**
 * The editor's library database for ONE server action, after `requireEditor()`
 * has decided the site: the photographer's own client for reading rows, and
 * the canonical read (through the service role, for that site only) for what
 * each row may be shown as. See lib/photos/library.ts and editor-proof.ts.
 *
 * The service-role client is made only when a proof is needed, and a missing
 * key is a photographer-readable error rather than an empty library.
 */
export async function editorLibraryDb(): Promise<LibraryDb> {
  const supabase = await createClient()
  let proof: ReturnType<typeof renderProof> | null = null
  return {
    from: (table) => supabase.from(table) as unknown as ReturnType<LibraryDb['from']>,
    prove: (tenantId, refs) => {
      if (!proof) {
        try {
          proof = renderProof(createAdminClient() as unknown as ProofRpc)
        } catch {
          return Promise.reject(new LibraryError('Your photographs could not be checked just now.'))
        }
      }
      return proof(tenantId, refs)
    },
  }
}
