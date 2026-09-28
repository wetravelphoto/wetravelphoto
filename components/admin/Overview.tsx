'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Icon, { type IconName } from '@/components/admin/Icon'
import PageThumb from '@/components/admin/PageThumb'
import { WINDOWS } from '@/lib/admin/audience-window'
import type { Audience, RecentItem } from '@/lib/admin/overview'
import type { Step } from '@/lib/start-here'

/**
 * WELCOME BACK
 * ════════════
 *
 * Four things, in the order somebody actually wants them:
 *
 *   1. their site, as it looks, with one button into the editor;
 *   2. what is left to do, while there is anything left to do;
 *   3. whether anyone has been;
 *   4. what they were last working on.
 *
 * ── Every number here is counted ───────────────────────────────────────────
 *
 * There is nothing estimated, projected or rounded on this screen, and no
 * metric that exists because a dashboard is expected to have metrics. A
 * photographer opens this to find out whether anything is happening; a number
 * that is nearly right is worse than none, because it will be believed.
 *
 * Where the application cannot answer honestly it says so on the tile — see
 * `subscribersAllTime`, and the note under Page views, which counts views of
 * galleries and stories because those are the only things instrumented.
 */

export default function Overview({
  firstName,
  siteName,
  host,
  hasDraft,
  audience,
  steps,
  stepsDone,
  showSteps,
  recent,
  unread,
  essentials,
}: {
  /** Null when nothing on file says what to call them — the greeting then
      drops the name rather than inventing one. */
  firstName: string | null
  siteName: string
  host: string | null
  hasDraft: boolean
  audience: Audience
  steps: Step[]
  stepsDone: number
  showSteps: boolean
  recent: RecentItem[]
  unread: number
  essentials: { id: string; label: string; detail: string; done: boolean; href: string; cta: string }[]
}) {
  const router = useRouter()

  return (
    <div className="ov">
      <header className="pb-head">
        <div className="pb-head-words">
          <h1 className="pb-title">{firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'}</h1>
          <p className="pb-sub">Your work, your website, and what’s next.</p>
        </div>

        <Link href="/admin/trips/new" className="lg-btn pb-new">
          <Icon name="plus" size={15} />
          Upload photos
        </Link>
      </header>

      <div className="ov-top">
        {/* ── The site itself ───────────────────────────────────────────────
            The biggest thing on the screen, because it is the thing they
            made. A dashboard whose largest element is a number is a dashboard
            about the tool rather than about the work. */}
        <section className="ov-site">
          <Link href="/edit/home" className="pc-shot ov-site-shot" aria-label="Open the editor">
            {/* Wider than a page card's: this is a window onto the site
                rather than a thumbnail to tell pages apart. */}
            <PageThumb page="home" ratio="16 / 9" className="ov-site-frame" />
          </Link>

          <div className="pc-foot ov-site-foot">
            <span className="pc-kind" aria-hidden>
              <Icon name="file" size={16} />
            </span>
            <span className="pc-id">
              <span className="pc-name">{siteName}</span>
              {host ? (
                <Link
                  href={`https://${host}`}
                  target="_blank"
                  rel="noreferrer"
                  className="pc-path ov-site-host"
                >
                  {host}
                  <Icon name="external" size={11} />
                </Link>
              ) : (
                <span className="pc-path">No address yet</span>
              )}
            </span>
            <span className="pc-state">
              <span className="pc-dot" data-tone={hasDraft ? 'waiting' : 'live'} aria-hidden />
              {hasDraft ? 'Live, with unpublished changes' : 'Live'}
            </span>
            <Link href="/edit/home" className="lg-btn lg-btn-primary ov-continue">
              Continue editing
              <Icon name="external" size={13} />
            </Link>
          </div>
        </section>

        {/* ── What is left to do, while there is anything ────────────────────
            Scaffolding, not furniture: `showSteps` goes false once the list
            has nothing to say, and the screen is one column wider for good. */}
        {showSteps && (
          <section className="ov-panel ov-steps">
            <div className="ov-panel-head">
              <h2 className="ov-h2">Make it yours</h2>
              <span className="admin-meta">
                {stepsDone} of {steps.length} complete
              </span>
            </div>

            <div
              className="ov-bar"
              role="progressbar"
              aria-valuenow={stepsDone}
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-label="Setup progress"
            >
              <span style={{ width: `${(stepsDone / steps.length) * 100}%` }} />
            </div>

            <ul className="ov-steps-list">
              {steps.map((step) => (
                <li key={step.id} data-done={step.done || undefined}>
                  <span className="ov-tick" aria-hidden>
                    {step.done && <Icon name="check" size={12} strokeWidth={3} />}
                  </span>
                  <span className="ov-step-words">
                    <span className="ov-step-title">{step.title}</span>
                    <span className="ov-step-note">{step.detail}</span>
                  </span>
                  {!step.done && (
                    <Link href={step.href} className="lg-ico ov-step-go" aria-label={step.title}>
                      <Icon name="chevron-right" size={16} />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* ── Has anyone been ─────────────────────────────────────────────────── */}
      <div className="ov-section-head">
        <h2 className="ov-h2 ov-h2-big">Your audience</h2>

        <label className="ov-window">
          <span className="cv-sr">How far back</span>
          <select
            value={audience.days}
            onChange={(e) => router.push(`/admin?days=${e.target.value}`)}
          >
            {WINDOWS.map((w) => (
              <option key={w.days} value={w.days}>
                {w.label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={14} />
        </label>
      </div>

      <div className="ov-stats">
        <Stat
          icon="clients"
          label="Visitors"
          value={audience.visitors}
          note="People who opened a gallery or story."
        />
        <Stat
          icon="file"
          label="Page views"
          value={audience.views}
          // Said plainly. The site's own pages are not instrumented, and a
          // tile reading "Page views" over a number that only counts two of
          // them is a number nobody can act on.
          note="Views of your galleries and stories."
        />
        <Stat
          icon="mail"
          label="Inquiries"
          value={audience.inquiries}
          note="Messages from potential clients."
          href="/admin/messages"
        />
        <Stat
          icon="clients"
          label="Subscribers"
          value={audience.subscribers}
          note={audience.subscribersAllTime ? 'People who subscribed, all time.' : 'People who subscribed.'}
        />
      </div>

      <div className="ov-split">
        {/* ── What they were last working on ─────────────────────────────── */}
        <section className="ov-panel">
          <div className="ov-panel-head">
            <h2 className="ov-h2">Recent content</h2>
            <Link href="/admin/trips" className="ov-more">
              View all content
              <Icon name="chevron-right" size={14} />
            </Link>
          </div>

          {recent.length === 0 ? (
            <p className="ov-none">
              Nothing yet. Upload a folder of photographs and it will show up here.
            </p>
          ) : (
            <ul className="ov-recent">
              {recent.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <Link href={item.href} className="ov-recent-link">
                    <span className="ov-thumb" aria-hidden>
                      {item.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.thumbUrl} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <Icon name={item.kind === 'gallery' ? 'image' : 'notebook'} size={16} />
                      )}
                    </span>
                    <span className="pc-id">
                      <span className="pc-name">{item.title}</span>
                      <span className="pc-path">{item.note}</span>
                    </span>
                  </Link>

                  {/* The sample content a new site arrives with. Worth marking:
                      "why is there a gallery I did not make" is the first
                      question every new site raises. */}
                  {item.sample ? (
                    <span className="ov-tag">Sample content</span>
                  ) : (
                    <span className="pc-state">
                      <span className="pc-dot" data-tone={item.state} aria-hidden />
                      {item.stateLabel}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── The three things that make a site a business ─────────────────── */}
        <section className="ov-panel">
          <div className="ov-panel-head">
            <h2 className="ov-h2">Site essentials</h2>
          </div>

          <ul className="ov-essentials">
            {essentials.map((item) => (
              <li key={item.id}>
                <span className="pc-dot" data-tone={item.done ? 'live' : 'idle'} aria-hidden />
                <span className="pc-id">
                  <span className="pc-name">{item.label}</span>
                  <span className="pc-path">{item.detail}</span>
                </span>
                {/* Done: the chevron alone, with the name on the LINK rather
                    than in a span inside it — one element, one name, and
                    nothing that becomes visible if a stylesheet goes missing. */}
                <Link
                  href={item.href}
                  className="ov-essential-go"
                  aria-label={item.done ? item.label : undefined}
                >
                  {!item.done && item.cta}
                  <Icon name="chevron-right" size={14} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* One line, and only when it is true. */}
      <p className="ov-foot">
        <Icon name="mail" size={16} />
        {unread > 0
          ? `${unread} ${unread === 1 ? 'inquiry is' : 'inquiries are'} waiting for a reply.`
          : 'You’re all caught up on inquiries.'}
        {unread > 0 && (
          <Link href="/admin/messages" className="ov-more">
            Open inquiries
            <Icon name="chevron-right" size={14} />
          </Link>
        )}
      </p>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  note,
  href,
}: {
  icon: IconName
  label: string
  value: number
  note: string
  href?: string
}) {
  const body = (
    <>
      <span className="ov-stat-icon" aria-hidden>
        <Icon name={icon} size={18} />
      </span>
      <span className="ov-stat-words">
        <span className="ov-stat-label">{label}</span>
        <span className="ov-stat-value">{value.toLocaleString()}</span>
        <span className="ov-stat-note">{note}</span>
      </span>
    </>
  )

  return href ? (
    <Link href={href} className="ov-panel ov-stat">
      {body}
    </Link>
  ) : (
    <div className="ov-panel ov-stat">{body}</div>
  )
}
