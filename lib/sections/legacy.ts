import type { SiteSettings } from '@/lib/site'
import type { StoredSection } from '@/lib/sections/load'

/**
 * The bridge out of the flat-column homepage.
 *
 * Until something is saved in the section editor, `page_sections` is empty and
 * the homepage is still described by the show_* / hero_* / intro_* columns on
 * site_settings. This turns those columns into the same section rows the
 * editor writes, so the live page looks identical whether it is reading the
 * table or this function — and the migration and the deploy can happen in
 * either order.
 *
 * THIS IS THE ONLY FILE THAT KNOWS THE OLD COLUMN NAMES. Nothing else reads
 * settings.intro_heading or settings.show_journal. When the last site has
 * materialized its sections, this file and those columns go together.
 */
export function legacyHomeSections(s: SiteSettings): StoredSection[] {
  const rows: Omit<StoredSection, 'position'>[] = [
    {
      id: 'legacy-hero',
      type: 'hero',
      visible: true,
      version: 1,
      settings: {
        mode: s.hero_mode ?? 'stories',
        title_position: s.hero_title_position ?? 'center',
        story_align: s.hero_story_align ?? 'left',
        image_path: s.hero_image_path,
        title: s.hero_fixed_title,
        subtitle: s.hero_fixed_subtitle,
        cta_label: s.hero_fixed_cta_label,
        cta_href: s.hero_fixed_cta_href,
        kicker: s.hero_kicker,
        focal: s.hero_fixed_focal ?? {},
        featured_post_ids: s.featured_post_ids ?? [],
        titles: s.hero_titles ?? {},
        subtitles: s.hero_subtitles ?? {},
        story_focal: s.hero_focal ?? {},
      },
    },
    {
      // The accent mark used to be drawn inside the hero, configured by the
      // show_bird / logo_bird_* columns. As a section it sits straight after
      // the hero, which is exactly where it always appeared. A site that never
      // uploaded its own used the built-in file, so that is what it keeps.
      id: 'legacy-mark',
      type: 'mark',
      // No mark unless this site has one. It used to fall back to
      // WeTravelPhoto's bird, which was that site's own logo appearing on
      // somebody else's homepage. WeTravelPhoto's row now names the file
      // explicitly (db/migrations/2026-09-23_own_marks.sql), so nothing
      // changes there.
      visible: s.show_bird !== false && Boolean(s.logo_bird_path),
      version: 1,
      settings: {
        image_path: s.logo_bird_path ?? '',
        align: 'center',
        size: s.logo_bird_size ?? 64,
      },
    },
    {
      id: 'legacy-intro',
      type: 'intro',
      visible: s.show_intro !== false,
      version: 1,
      settings: {
        kicker: s.intro_kicker,
        heading: s.intro_heading,
        body: s.intro_body,
        image_path: s.intro_image_path,
        image_side: s.intro_image_side ?? 'left',
      },
    },
    {
      id: 'legacy-galleries',
      type: 'galleries',
      visible: s.show_galleries !== false,
      version: 1,
      settings: {
        heading: s.carousel_heading || 'Recent trips',
        limit: 0,
      },
    },
    {
      id: 'legacy-journal',
      type: 'journal',
      visible: s.show_journal !== false,
      version: 1,
      settings: {
        heading: s.journal_heading || 'From the journal',
        count: s.journal_count ?? 3,
        cta_label: 'View all stories',
      },
    },
    {
      id: 'legacy-instagram',
      type: 'instagram',
      visible: !!s.show_instagram,
      version: 1,
      settings: {
        heading: s.instagram_heading,
        count: 9,
      },
    },
    {
      id: 'legacy-contact',
      type: 'contact',
      visible: s.show_contact_section !== false,
      version: 1,
      settings: {
        eyebrow: s.contact_eyebrow,
        heading: s.contact_heading,
        intro: s.contact_intro,
        note: s.contact_note,
        tagline: s.contact_tagline,
        image_path: s.contact_image_path,
        image_side: s.contact_image_side ?? 'left',
      },
    },
  ]

  return rows.map((row, position) => ({ ...row, position }))
}

/**
 * The About page, from the about_* columns app/about/page.tsx used to read.
 * The old page showed "About" when no heading was set, so that is carried in
 * as the heading rather than kept as a hidden fallback in the renderer.
 */
export function legacyAboutSections(s: SiteSettings): StoredSection[] {
  return [
    {
      id: 'legacy-about',
      type: 'about',
      position: 0,
      visible: true,
      version: 1,
      settings: {
        eyebrow: s.about_eyebrow,
        heading: s.about_heading || 'About',
        body: s.about_body,
        image_path: s.about_image_path,
        image_side: s.about_image_side ?? 'left',
        cta_label: s.about_cta_label,
        cta_href: s.about_cta_href,
      },
    },
  ]
}

/**
 * The Contact page, as app/contact/page.tsx drew it: a heading, the contact
 * intro line, and the form — the Contact section in its centred layout. From
 * its first Publish its words are its own.
 */
export function legacyContactSections(s: SiteSettings): StoredSection[] {
  return [
    {
      id: 'legacy-contact-page',
      type: 'contact',
      position: 0,
      visible: true,
      version: 1,
      settings: {
        layout: 'centered',
        heading: 'Contact',
        intro: s.contact_intro,
      },
    },
  ]
}

/**
 * The Journal page: every story, the newest drawn large — the journal
 * section's grid layout, from the journal_page_* and journal_show_* columns.
 */
export function legacyJournalSections(s: SiteSettings): StoredSection[] {
  return [
    {
      id: 'legacy-journal-page',
      type: 'journal',
      position: 0,
      visible: true,
      version: 1,
      settings: {
        layout: 'grid',
        eyebrow: s.journal_page_eyebrow,
        heading: s.journal_page_heading || 'Journal',
        show_excerpt: s.journal_show_excerpt !== false,
        show_date: s.journal_show_date === true,
        show_byline: s.journal_show_byline === true,
        title_scale: s.journal_title_scale ?? 1,
      },
    },
  ]
}

/** The Galleries page: every public gallery as a tile — the grid layout. */
export function legacyGalleriesSections(s: SiteSettings): StoredSection[] {
  return [
    {
      id: 'legacy-galleries-page',
      type: 'galleries',
      position: 0,
      visible: true,
      version: 1,
      settings: {
        layout: 'grid',
        eyebrow: s.galleries_eyebrow,
        heading: s.galleries_heading || 'Galleries',
        limit: 0,
      },
    },
  ]
}

/** The Shop page: the print wall, from the shop_* page columns. */
export function legacyShopSections(s: SiteSettings): StoredSection[] {
  return [
    {
      id: 'legacy-shop-page',
      type: 'shop',
      position: 0,
      visible: true,
      version: 1,
      settings: {
        eyebrow: s.shop_eyebrow,
        heading: s.shop_heading || 'Prints',
        subheading: s.shop_subheading,
        intro: s.shop_intro,
        // What the page drew, which is not what the old form showed: the form
        // defaulted to four, the page to three.
        columns: Number(s.shop_columns) || 3,
        show_location: s.shop_show_location !== false,
        show_collection: s.shop_show_collection !== false,
        show_price: s.shop_show_price !== false,
      },
    },
  ]
}

/** Any editable page, before anything has been published for it. */
/**
 * The "page not found" page as it was written in code before it could be
 * edited: a line, a heading, a sentence and the way back. From its first
 * Publish it is the photographer's own.
 */
export function legacyNotFoundSections(): StoredSection[] {
  return [
    {
      id: 'legacy-notfound',
      type: 'intro',
      position: 0,
      visible: true,
      version: 1,
      settings: {
        kicker: 'Error 404',
        heading: 'Off the map',
        body: "This page doesn't exist, or the album you're looking for is private.",
        space_top: 'xl',
      },
    },
  ]
}

export function legacyPageSections(page: string, s: SiteSettings): StoredSection[] {
  switch (page) {
    case 'home':
      return legacyHomeSections(s)
    case 'about':
      return legacyAboutSections(s)
    case 'contact':
      return legacyContactSections(s)
    case 'journal':
      return legacyJournalSections(s)
    case 'galleries':
      return legacyGalleriesSections(s)
    case 'shop':
      return legacyShopSections(s)
    case 'notfound':
      return legacyNotFoundSections()
    default:
      // A page with no history starts empty — never borrow another page's.
      return []
  }
}

/**
 * Which sections the old columns described, page by page. Only these are
 * mirrored back. The Contact page's contact section, say, must not write the
 * contact_* columns: those describe the HOMEPAGE's contact section, and two
 * sections writing one column means whichever published last wins.
 */
export const MIRRORED: Record<string, string[]> = {
  home: ['hero', 'mark', 'intro', 'galleries', 'journal', 'instagram', 'contact'],
  about: ['about'],
  journal: ['journal'],
  galleries: ['galleries'],
  shop: ['shop'],
}

/**
 * The same mapping backwards: a section's settings as site_settings columns.
 *
 * The old homepage form that wrote these columns is gone (2026-09-21). The
 * mirror stays as the way back: if the code is ever rolled back past the
 * section engine, the columns still describe the page as it was last
 * published. It goes when that stops being worth having.
 */
export function legacyColumns(
  page: string,
  type: string,
  settings: Record<string, unknown>,
  visible: boolean
): Record<string, unknown> | null {
  const s = settings

  // The same section type can describe different columns on different pages:
  // the journal section on the Journal page is the journal_page_* columns, not
  // the homepage's journal row.
  if (page === 'journal' && type === 'journal') {
    return {
      journal_page_eyebrow: s.eyebrow,
      journal_page_heading: s.heading,
      journal_show_excerpt: s.show_excerpt !== false,
      journal_show_date: s.show_date === true,
      journal_show_byline: s.show_byline === true,
      journal_title_scale: s.title_scale,
    }
  }

  // Each print's own page is not edited in the canvas and still reads these
  // columns — its title, breadcrumb and captions — so the wall keeps them
  // current on every Publish. Here the mirror is not a way back; it is the
  // live contract for that page.
  if (page === 'shop' && type === 'shop') {
    return {
      shop_eyebrow: s.eyebrow,
      shop_heading: s.heading,
      shop_subheading: s.subheading,
      shop_intro: s.intro,
      shop_columns: s.columns,
      shop_show_location: s.show_location !== false,
      shop_show_collection: s.show_collection !== false,
      shop_show_price: s.show_price !== false,
    }
  }

  if (page === 'galleries' && type === 'galleries') {
    return {
      galleries_eyebrow: s.eyebrow,
      galleries_heading: s.heading,
    }
  }

  switch (type) {
    case 'hero':
      return {
        hero_mode: s.mode,
        hero_title_position: s.title_position,
        hero_story_align: s.story_align,
        hero_image_path: s.image_path,
        hero_fixed_title: s.title,
        hero_fixed_subtitle: s.subtitle,
        hero_fixed_cta_label: s.cta_label,
        hero_fixed_cta_href: s.cta_href,
        hero_kicker: s.kicker,
      }

    case 'intro':
      return {
        show_intro: visible,
        intro_kicker: s.kicker,
        intro_heading: s.heading,
        intro_body: s.body,
        intro_image_path: s.image_path,
        intro_image_side: s.image_side,
      }

    case 'galleries':
      return {
        show_galleries: visible,
        carousel_heading: s.heading,
      }

    case 'journal':
      return {
        show_journal: visible,
        journal_heading: s.heading,
        journal_count: s.count,
      }

    case 'instagram':
      return {
        show_instagram: visible,
        instagram_heading: s.heading,
      }

    case 'contact':
      return {
        show_contact_section: visible,
        contact_eyebrow: s.eyebrow,
        contact_heading: s.heading,
        contact_intro: s.intro,
        contact_note: s.note,
        contact_tagline: s.tagline,
        contact_image_path: s.image_path,
        contact_image_side: s.image_side,
      }

    case 'about':
      return {
        about_eyebrow: s.eyebrow,
        about_heading: s.heading,
        about_body: s.body,
        about_image_path: s.image_path,
        about_image_side: s.image_side,
        about_cta_label: s.cta_label,
        about_cta_href: s.cta_href,
      }

    case 'mark':
      // Mirrored so that rolling the code back past the mark section still
      // draws the same emblem. A built-in path has no column form — the old
      // code expressed "built-in" as an empty column.
      return {
        show_bird: visible,
        logo_bird_size: s.size,
        logo_bird_path:
          typeof s.image_path === 'string' && !s.image_path.startsWith('/') ? s.image_path : null,
      }

    default:
      // A section type invented after the flat columns has nothing to mirror.
      return null
  }
}
