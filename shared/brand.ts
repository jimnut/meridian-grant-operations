/**
 * Central brand configuration.
 *
 * This is the source of truth for in-app brand surfaces such as sign-in,
 * navigation, page titles, reporting packets, and exports. The dependency-free
 * marketing page and repository documentation remain intentionally static.
 */
export const BRAND = {
  /** Product wordmark. */
  name: 'GrantConsole',
  /** Full legal/marketing name used in document headers and the sign-in card. */
  fullName: 'GrantConsole — Grant Operations',
  /** Short descriptor placed under the wordmark. */
  descriptor: 'Grant Operations',
  /** One-line value proposition. */
  tagline:
    'One calm workspace for grant teams to manage deadlines, restricted budgets, compliance work, evidence, renewals, and audit-ready funder reports.',
  /** Compact tagline for tight spaces. */
  shortTagline: 'Post-award grant health, in one place.',
  /** Monogram used in the sidebar mark. */
  monogram: 'G',
  /** Suffix appended to browser document titles. */
  titleSuffix: 'GrantConsole',
  /** Used in exported file names — lowercase, filesystem safe. */
  fileSlug: 'grantconsole',
  /** Support contact surfaced in error states. */
  supportEmail: 'support@grantconsole.com',
} as const;

export type Brand = typeof BRAND;
