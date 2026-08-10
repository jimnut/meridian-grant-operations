import type { Role } from '../../shared/constants';

/**
 * Shared password for every seeded demo account.
 *
 * This is demo-only data for a local workspace. Real deployments create users
 * through an invitation flow and never ship a known password.
 */
export const DEMO_PASSWORD = 'GrantConsole!Demo2026';

export interface DemoUserSpec {
  key: string;
  name: string;
  email: string;
  title: string;
  memberships: Array<{ orgKey: string; role: Role }>;
}

export const DEMO_ORG_PRIMARY = 'riverbend';
export const DEMO_ORG_SECONDARY = 'cascade';

export const DEMO_USERS: DemoUserSpec[] = [
  {
    key: 'dana',
    name: 'Dana Whitfield',
    email: 'dana@riverbendalliance.org',
    title: 'Executive Director',
    memberships: [
      { orgKey: DEMO_ORG_PRIMARY, role: 'OWNER' },
      // Dana also sits on the board of a partner nonprofit, which exercises the
      // organization switcher and proves roles are per-organization.
      { orgKey: DEMO_ORG_SECONDARY, role: 'VIEWER' },
    ],
  },
  {
    key: 'marcus',
    name: 'Marcus Oyelaran',
    email: 'marcus@riverbendalliance.org',
    title: 'Director of Development & Grants',
    memberships: [{ orgKey: DEMO_ORG_PRIMARY, role: 'MANAGER' }],
  },
  {
    key: 'priya',
    name: 'Priya Raghunathan',
    email: 'priya@riverbendalliance.org',
    title: 'Grants & Compliance Coordinator',
    memberships: [{ orgKey: DEMO_ORG_PRIMARY, role: 'MEMBER' }],
  },
  {
    key: 'naomi',
    name: 'Naomi Feldstein',
    email: 'naomi@riverbendalliance.org',
    title: 'Finance Manager',
    memberships: [{ orgKey: DEMO_ORG_PRIMARY, role: 'MEMBER' }],
  },
  {
    key: 'tomas',
    name: 'Tomás Herrera',
    email: 'tomas@riverbendalliance.org',
    title: 'Board Treasurer',
    memberships: [{ orgKey: DEMO_ORG_PRIMARY, role: 'VIEWER' }],
  },
  {
    key: 'renee',
    name: 'Renée Baptiste',
    email: 'renee@cascadeyouth.org',
    title: 'Executive Director',
    memberships: [{ orgKey: DEMO_ORG_SECONDARY, role: 'OWNER' }],
  },
  {
    key: 'wes',
    name: 'Wes Ordoñez',
    email: 'wes@cascadeyouth.org',
    title: 'Program Manager',
    memberships: [{ orgKey: DEMO_ORG_SECONDARY, role: 'MEMBER' }],
  },
];
