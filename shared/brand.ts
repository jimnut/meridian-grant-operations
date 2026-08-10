/**
 * Central brand configuration.
 *
 * Renaming the product is a single-file change: update the values here and every
 * surface (sign-in, navigation, page titles, reporting packets, CSV exports,
 * README-facing strings) follows.
 */
export const BRAND = {
  /** Product wordmark. */
  name: 'Meridian',
  /** Full legal/marketing name used in document headers and the sign-in card. */
  fullName: 'Meridian Grant Operations',
  /** Short descriptor placed under the wordmark. */
  descriptor: 'Grant Operations',
  /** One-line value proposition. */
  tagline:
    'One calm workspace for grant teams to manage deadlines, restricted budgets, compliance work, evidence, renewals, and audit-ready funder reports.',
  /** Compact tagline for tight spaces. */
  shortTagline: 'Post-award grant health, in one place.',
  /** Monogram used in the sidebar mark. */
  monogram: 'M',
  /** Suffix appended to browser document titles. */
  titleSuffix: 'Meridian',
  /** Used in exported file names — lowercase, filesystem safe. */
  fileSlug: 'meridian',
  /** Support contact surfaced in error states. */
  supportEmail: 'support@meridian.example',
} as const;

export type Brand = typeof BRAND;
