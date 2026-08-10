import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { logActivity } from '../../server/lib/activity';
import {
  createTestContext,
  DEMO_USERS,
  grantIdByTitle,
  orgIdBySlug,
  seedContext,
  signIn,
  type Client,
  type TestContext,
} from '../helpers/context';

let context: TestContext;
let owner: Client;
let grantId: string;
let totalEntries: number;

beforeAll(async () => {
  context = createTestContext();
  await seedContext(context);
  owner = await signIn(context.app, DEMO_USERS.owner);
  grantId = grantIdByTitle(context.db, 'Family Stability Navigators');

  // Push the trail well past the 120-entry window the grant workspace shows.
  const orgId = orgIdBySlug(context.db, 'riverbend');
  for (let i = 0; i < 150; i += 1) {
    logActivity(context.db, {
      orgId,
      actorUserId: owner.session.user.id,
      entityType: 'GRANT',
      entityId: grantId,
      grantId,
      action: 'UPDATED',
      summary: `Synthetic audit entry ${i + 1}`,
    });
  }

  totalEntries = (
    context.db.prepare('SELECT COUNT(*) AS count FROM activities WHERE grant_id = ?').get(grantId) as {
      count: number;
    }
  ).count;
  expect(totalEntries).toBeGreaterThan(120);
});

afterAll(() => context.cleanup());

describe('activity trail limits', () => {
  it('keeps the grant workspace to a recent 120-entry window', async () => {
    const response = await owner.agent.get(`/api/grants/${grantId}`);
    expect(response.status).toBe(200);
    expect(response.body.activity).toHaveLength(120);
  });

  it('returns the complete trail in the reporting packet', async () => {
    const response = await owner.agent.get(`/api/grants/${grantId}/packet`);
    expect(response.status).toBe(200);

    const activity = response.body.grant.activity as Array<{ createdAt: string }>;
    expect(activity).toHaveLength(totalEntries);

    // Newest first, so the packet reads as a reverse-chronological audit log.
    for (let i = 1; i < activity.length; i += 1) {
      expect(activity[i - 1]!.createdAt >= activity[i]!.createdAt).toBe(true);
    }
  });
});
