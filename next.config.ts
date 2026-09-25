import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
};

/**
 * ERROR REPORTING IS OPT-IN, AT BUILD TIME TOO
 *
 * Wrapped only when a DSN exists. Without one this is the plain config it has
 * always been: no build plugin, no source-map step, no upload attempt, and no
 * warning printed on every local build about credentials nobody set. Someone
 * cloning this repo builds it unchanged.
 *
 * `withSentryConfig` lives at `@sentry/nextjs/config` in v11 — the package
 * root no longer exports it, which most guides still say it does.
 *
 * `SENTRY_AUTH_TOKEN` is the only secret here and it is build-time only:
 * without it the build still succeeds, it just uploads no source maps, so a
 * stack trace names the minified bundle instead of the line. The DSN is not a
 * secret — it identifies a project to send to, it does not grant read access
 * to anything.
 */
const withErrorReporting = (config: NextConfig): NextConfig =>
  process.env.NEXT_PUBLIC_SENTRY_DSN
    ? withSentryConfig(config, {
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,

        // Quiet locally, loud in CI, where nobody is watching the output live.
        silent: !process.env.CI,

        // Source maps are uploaded and then deleted from the deployed output:
        // a stack trace that names the real line is the whole point, and a
        // public .map file hands the site's source to anyone who asks.
        sourcemaps: { deleteSourcemapsAfterUpload: true },

        // Reports are sent through this app's own domain rather than straight
        // to Sentry, so an ad blocker on a photographer's browser does not
        // quietly swallow the one report that mattered.
        tunnelRoute: '/monitoring',
      })
    : config;

export default withErrorReporting(nextConfig);
