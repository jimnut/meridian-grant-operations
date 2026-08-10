import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../server/app';
import { openDatabase, type Db } from '../../server/db/connection';
import { seedDemoData } from '../../server/db/seed';
import { DEMO_PASSWORD } from '../../server/db/demo-accounts';
import type { SessionPayload } from '../../shared/types';

export interface TestContext {
  app: Express;
  db: Db;
  uploadsDir: string;
  cleanup: () => void;
}

/** Fresh in-memory database + isolated uploads directory per test file. */
export function createTestContext(): TestContext {
  const db = openDatabase(':memory:');
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-test-'));
  // Uploads are written to a temp dir, never the real data directory.
  const app = createApp({ db, uploadsDir });
  return {
    app,
    db,
    uploadsDir,
    cleanup: () => {
      db.close();
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    },
  };
}

export async function seedContext(context: TestContext, now?: Date) {
  return seedDemoData(context.db, { force: true, uploadsDir: context.uploadsDir, now });
}

export interface Client {
  agent: ReturnType<typeof request.agent>;
  session: SessionPayload;
  csrf: string;
}

export const DEMO_USERS = {
  owner: 'dana@riverbendalliance.org',
  manager: 'marcus@riverbendalliance.org',
  member: 'priya@riverbendalliance.org',
  finance: 'naomi@riverbendalliance.org',
  viewer: 'tomas@riverbendalliance.org',
  otherOrgOwner: 'renee@cascadeyouth.org',
  otherOrgMember: 'wes@cascadeyouth.org',
} as const;

/** Signs in and returns a cookie-persisting agent plus the CSRF token. */
export async function signIn(app: Express, email: string, password = DEMO_PASSWORD): Promise<Client> {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/sign-in').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Sign-in failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const session = response.body as SessionPayload;
  return { agent, session, csrf: session.csrfToken };
}

/** Convenience wrappers that always attach the CSRF header. */
export function post(client: Client, url: string) {
  return client.agent.post(url).set('x-csrf-token', client.csrf);
}
export function put(client: Client, url: string) {
  return client.agent.put(url).set('x-csrf-token', client.csrf);
}
export function patch(client: Client, url: string) {
  return client.agent.patch(url).set('x-csrf-token', client.csrf);
}
export function del(client: Client, url: string) {
  return client.agent.delete(url).set('x-csrf-token', client.csrf);
}

export function grantIdByTitle(db: Db, title: string): string {
  const row = db.prepare('SELECT id FROM grants WHERE title = ?').get(title) as { id: string } | undefined;
  if (!row) throw new Error(`No seeded grant titled ${title}`);
  return row.id;
}

export function orgIdBySlug(db: Db, slug: string): string {
  const row = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug) as { id: string } | undefined;
  if (!row) throw new Error(`No seeded organization ${slug}`);
  return row.id;
}
