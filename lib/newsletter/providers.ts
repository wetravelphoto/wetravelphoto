import { createHash } from 'crypto'

/**
 * NEWSLETTER CONNECTORS
 * ═════════════════════
 *
 * Each photographer keeps sign-ups in the mailing service THEY use — or opens
 * a free account at one. They paste the service's API key into Settings
 * once, pick which list new sign-ups join, and from then on every sign-up on
 * their site is sent there as it happens. Sign-ups are also always kept in
 * Lens Grid's own table, so nothing is lost if a service is down or the
 * connection is changed, and "Send existing sign-ups" catches up.
 *
 * One object per service, all the same shape, so adding a service is adding
 * an entry here and nothing else. Each one knows:
 *   - where its key is found (shown in Settings as instructions);
 *   - how to list the lists a sign-up can join (which also proves the key
 *     works);
 *   - how to add one email to one list.
 *
 * Plain fetch with a timeout: no SDKs, and a slow service cannot hold up a
 * visitor's sign-up for long.
 */

export type ListOption = { id: string; name: string }

export type Provider = {
  id: ProviderId
  name: string
  /** What the service calls a list: "audience", "form", "group"… */
  listWord: string
  /** Where to find the key, step by step, in plain words. */
  keyHelp: string
  keyUrl: string
  /** Whether "ask new subscribers to confirm" is supported through the API. */
  doubleOptIn: boolean
  lists(key: string): Promise<ListOption[]>
  add(key: string, listId: string, email: string, options: { doubleOptIn: boolean; referrer: string }): Promise<void>
}

export type ProviderId = 'mailchimp' | 'kit' | 'mailerlite' | 'brevo' | 'flodesk'

const TIMEOUT = 8_000

async function call(url: string, init: RequestInit & { json?: unknown } = {}): Promise<unknown> {
  const { json, headers, ...rest } = init
  const response = await fetch(url, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers as Record<string, string>),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
    signal: AbortSignal.timeout(TIMEOUT),
    cache: 'no-store',
  })

  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('The service did not accept that API key. Check it was copied in full.')
    }
    const b = body as Record<string, unknown> | null
    const detail =
      (typeof b?.detail === 'string' && b.detail) ||
      (typeof b?.message === 'string' && b.message) ||
      (typeof b?.title === 'string' && b.title) ||
      (Array.isArray(b?.errors) && typeof b.errors[0] === 'string' && b.errors[0]) ||
      `error ${response.status}`
    throw new Error(`The service said: ${String(detail).slice(0, 200)}`)
  }
  return body
}

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`

/** Pulls [{id, name}] out of whichever wrapper a service uses. */
function toLists(rows: unknown): ListOption[] {
  if (!Array.isArray(rows)) return []
  return rows
    .map((r) => {
      const row = r as Record<string, unknown>
      const id = row.id ?? row.list_id
      const name = row.name ?? row.title
      return id !== undefined && id !== null ? { id: String(id), name: String(name ?? id) } : null
    })
    .filter((r): r is ListOption => r !== null)
}

// ── Mailchimp ────────────────────────────────────────────────────────────────

/** A Mailchimp key ends in its data centre ("…-us21"), which is part of the address. */
function mailchimpBase(key: string): string {
  const dc = key.split('-').pop() ?? ''
  if (!/^[a-z]+\d+$/.test(dc)) {
    throw new Error('That does not look like a Mailchimp key: it should end in something like "-us21".')
  }
  return `https://${dc}.api.mailchimp.com/3.0`
}

const mailchimp: Provider = {
  id: 'mailchimp',
  name: 'Mailchimp',
  listWord: 'audience',
  keyHelp:
    'In Mailchimp: click your profile picture → Profile → Extras → API keys → Create A Key. Copy the whole key (it ends in something like -us21).',
  keyUrl: 'https://admin.mailchimp.com/account/api/',
  doubleOptIn: true,
  async lists(key) {
    const body = (await call(`${mailchimpBase(key)}/lists?count=100&fields=lists.id,lists.name`, {
      headers: { Authorization: basic('lensgrid', key) },
    })) as { lists?: unknown }
    return toLists(body?.lists)
  },
  async add(key, listId, email, { doubleOptIn }) {
    const hash = createHash('md5').update(email.toLowerCase()).digest('hex')
    await call(`${mailchimpBase(key)}/lists/${encodeURIComponent(listId)}/members/${hash}`, {
      method: 'PUT',
      headers: { Authorization: basic('lensgrid', key) },
      // status_if_new: someone already on the list is left as they are, so a
      // person who unsubscribed is never quietly re-subscribed.
      json: { email_address: email, status_if_new: doubleOptIn ? 'pending' : 'subscribed' },
    })
  },
}

// ── Kit (formerly ConvertKit) ────────────────────────────────────────────────

const kit: Provider = {
  id: 'kit',
  name: 'Kit (ConvertKit)',
  listWord: 'form',
  keyHelp:
    'In Kit: Settings → Developer → Add a new key (v4). Copy the key. New sign-ups are added to the form you choose, which also runs its own welcome emails.',
  keyUrl: 'https://app.kit.com/account_settings/developer_settings',
  doubleOptIn: false,
  async lists(key) {
    const body = (await call('https://api.kit.com/v4/forms?per_page=100', {
      headers: { 'X-Kit-Api-Key': key },
    })) as { forms?: unknown }
    return toLists(body?.forms)
  },
  async add(key, listId, email, { referrer }) {
    const created = (await call('https://api.kit.com/v4/subscribers', {
      method: 'POST',
      headers: { 'X-Kit-Api-Key': key },
      json: { email_address: email },
    })) as { subscriber?: { id?: number | string } }
    const id = created?.subscriber?.id
    if (id === undefined) throw new Error('Kit did not return the new subscriber.')
    await call(`https://api.kit.com/v4/forms/${encodeURIComponent(listId)}/subscribers/${id}`, {
      method: 'POST',
      headers: { 'X-Kit-Api-Key': key },
      json: { referrer },
    })
  },
}

// ── MailerLite ───────────────────────────────────────────────────────────────

const mailerlite: Provider = {
  id: 'mailerlite',
  name: 'MailerLite',
  listWord: 'group',
  keyHelp: 'In MailerLite: Integrations → MailerLite API → Generate new token. Copy the token.',
  keyUrl: 'https://dashboard.mailerlite.com/integrations/api',
  doubleOptIn: false,
  async lists(key) {
    const body = (await call('https://connect.mailerlite.com/api/groups?limit=100', {
      headers: { Authorization: `Bearer ${key}` },
    })) as { data?: unknown }
    return toLists(body?.data)
  },
  async add(key, listId, email) {
    await call('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      json: { email, groups: [listId] },
    })
  },
}

// ── Brevo (formerly Sendinblue) ──────────────────────────────────────────────

const brevo: Provider = {
  id: 'brevo',
  name: 'Brevo',
  listWord: 'list',
  keyHelp: 'In Brevo: click your name (top right) → SMTP & API → API Keys → Generate a new API key. Copy it.',
  keyUrl: 'https://app.brevo.com/settings/keys/api',
  doubleOptIn: false,
  async lists(key) {
    const body = (await call('https://api.brevo.com/v3/contacts/lists?limit=50', {
      headers: { 'api-key': key },
    })) as { lists?: unknown }
    return toLists(body?.lists)
  },
  async add(key, listId, email) {
    await call('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': key },
      json: { email, listIds: [Number(listId)], updateEnabled: true },
    })
  },
}

// ── Flodesk ──────────────────────────────────────────────────────────────────

const flodesk: Provider = {
  id: 'flodesk',
  name: 'Flodesk',
  listWord: 'segment',
  keyHelp: 'In Flodesk: Account settings → Integrations → API keys → Create API key. Copy it.',
  keyUrl: 'https://app.flodesk.com/account/integrations/api',
  doubleOptIn: true,
  async lists(key) {
    const body = (await call('https://api.flodesk.com/v1/segments?per_page=100', {
      headers: { Authorization: basic(key, '') },
    })) as { data?: unknown } | unknown[]
    return toLists(Array.isArray(body) ? body : (body as { data?: unknown })?.data)
  },
  async add(key, listId, email, { doubleOptIn }) {
    await call('https://api.flodesk.com/v1/subscribers', {
      method: 'POST',
      headers: { Authorization: basic(key, '') },
      json: { email, segment_ids: [listId], double_optin: doubleOptIn },
    })
  },
}

export const PROVIDERS: Record<ProviderId, Provider> = { mailchimp, kit, mailerlite, brevo, flodesk }

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, value)
}

/** The parts of each provider the Settings page shows (no functions). */
export function providerInfo() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    listWord: p.listWord,
    keyHelp: p.keyHelp,
    keyUrl: p.keyUrl,
    doubleOptIn: p.doubleOptIn,
  }))
}
export type ProviderInfo = ReturnType<typeof providerInfo>[number]
