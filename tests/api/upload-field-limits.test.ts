import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildDemoPdf } from '../../server/db/demo-pdf';
import {
  createTestContext,
  DEMO_USERS,
  grantIdByTitle,
  seedContext,
  signIn,
  type Client,
  type TestContext,
} from '../helpers/context';

let context: TestContext;
let owner: Client;
let grantId: string;

beforeAll(async () => {
  context = await createTestContext();
  await seedContext(context);
  owner = await signIn(context.app, DEMO_USERS.owner);
  grantId = grantIdByTitle(context.db, 'Early Literacy Home Visits');
});

afterAll(() => context.cleanup());

describe('multipart metadata limits', () => {
  it('rejects an oversized field array index and continues serving normal uploads', async () => {
    // One field is sufficient to test early rejection. Never send the second
    // field that triggers the old parser's sparse-array crash or long loop.
    const rejected = await owner.agent
      .post(`/api/grants/${grantId}/documents`)
      .set('x-csrf-token', owner.csrf)
      .field('metadata[4294967294]', 'example')
      .timeout({ response: 2000, deadline: 3000 });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('BAD_REQUEST');
    expect(rejected.body.error.message).toContain('plain field names');

    const health = await owner.agent.get('/api/health');
    expect(health.status).toBe(200);

    const accepted = await owner.agent
      .post(`/api/grants/${grantId}/documents`)
      .set('x-csrf-token', owner.csrf)
      .field('docType', 'NARRATIVE')
      .attach('file', buildDemoPdf('Parser regression', ['Synthetic test evidence.']), {
        filename: 'parser-regression.pdf',
        contentType: 'application/pdf',
      });
    expect(accepted.status).toBe(201);
    expect(accepted.body.docType).toBe('NARRATIVE');
  });
});
