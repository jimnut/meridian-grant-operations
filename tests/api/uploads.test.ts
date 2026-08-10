import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { config } from '../../server/config';
import { buildDemoPdf } from '../../server/db/demo-pdf';
import { buildDemoXlsx, buildZip } from '../../server/db/demo-xlsx';
import {
  createTestContext,
  DEMO_USERS,
  del,
  grantIdByTitle,
  seedContext,
  signIn,
  type Client,
  type TestContext,
} from '../helpers/context';

let context: TestContext;
let owner: Client;
let member: Client;
let grantId: string;

const PDF = buildDemoPdf('Test evidence', ['Uploaded during the automated test run.']);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function upload(client: Client, file: Buffer, filename: string, mime: string, fields: Record<string, string> = {}) {
  const req = client.agent
    .post(`/api/grants/${grantId}/documents`)
    .set('x-csrf-token', client.csrf)
    .attach('file', file, { filename, contentType: mime });
  for (const [key, value] of Object.entries(fields)) {
    req.field(key, value);
  }
  return req;
}

beforeAll(async () => {
  context = createTestContext();
  await seedContext(context);
  owner = await signIn(context.app, DEMO_USERS.owner);
  member = await signIn(context.app, DEMO_USERS.member);
  grantId = grantIdByTitle(context.db, 'Early Literacy Home Visits');
});

afterAll(() => {
  // Uploads land in the injected per-test temp root; cleanup removes it. The
  // real data directory is never touched by this suite.
  context.cleanup();
});

describe('uploading evidence', () => {
  let documentId: string;

  it('accepts a PDF and stores it under a generated key', async () => {
    const response = await upload(owner, PDF, 'Q3 Narrative Report.pdf', 'application/pdf', {
      docType: 'NARRATIVE',
    });

    expect(response.status).toBe(201);
    documentId = response.body.id;
    expect(response.body.originalName).toBe('Q3 Narrative Report.pdf');
    expect(response.body.docType).toBe('NARRATIVE');
    expect(response.body.sizeBytes).toBe(PDF.length);
    expect(response.body.uploadedByName).toBe(owner.session.user.name);
    // The storage key is never exposed to the client.
    expect(JSON.stringify(response.body)).not.toContain('storageKey');

    const row = context.db.prepare('SELECT storage_key AS key FROM documents WHERE id = ?').get(documentId) as {
      key: string;
    };
    expect(row.key).not.toContain('Narrative');
    expect(row.key).not.toContain('..');
    expect(fs.existsSync(path.join(context.uploadsDir, row.key))).toBe(true);
  });

  it('sanitises a traversal filename down to a bare basename', async () => {
    const hostile = ['..', '..', '..', 'etc', 'evil.pdf'].join('/');
    const response = await upload(owner, PDF, hostile, 'application/pdf');
    expect(response.status).toBe(201);
    expect(response.body.originalName).toBe('evil.pdf');

    const row = context.db
      .prepare('SELECT storage_key AS key FROM documents WHERE id = ?')
      .get(response.body.id) as { key: string };
    const resolved = path.resolve(context.uploadsDir, row.key);
    expect(resolved.startsWith(path.resolve(context.uploadsDir))).toBe(true);
    expect(fs.existsSync('/etc/evil.pdf')).toBe(false);
  });

  it('links evidence to a deliverable and raises its attached count', async () => {
    const milestoneId = (
      context.db.prepare('SELECT id FROM milestones WHERE grant_id = ? LIMIT 1').get(grantId) as { id: string }
    ).id;

    const before = (await owner.agent.get(`/api/grants/${grantId}`)).body.milestones.find(
      (m: { id: string }) => m.id === milestoneId,
    ).attachedEvidenceCount;

    const response = await upload(owner, PDF, 'Linked evidence.pdf', 'application/pdf', {
      docType: 'FINANCIAL',
      milestoneId,
    });
    expect(response.status).toBe(201);
    expect(response.body.milestoneId).toBe(milestoneId);

    const after = (await owner.agent.get(`/api/grants/${grantId}`)).body.milestones.find(
      (m: { id: string }) => m.id === milestoneId,
    ).attachedEvidenceCount;
    expect(after).toBe(before + 1);
  });

  it('rejects a deliverable id from another grant', async () => {
    const otherMilestoneId = (
      context.db.prepare('SELECT id FROM milestones WHERE grant_id <> ? LIMIT 1').get(grantId) as { id: string }
    ).id;
    const response = await upload(owner, PDF, 'Mislinked.pdf', 'application/pdf', {
      milestoneId: otherMilestoneId,
    });
    expect(response.status).toBe(404);
  });

  it('rejects disallowed types with a helpful message', async () => {
    const exe = await upload(owner, Buffer.from('MZ binary'), 'installer.' + 'exe', 'application/x-msdownload');
    expect(exe.status).toBe(415);
    expect(exe.body.error.message).toMatch(/not accepted/i);

    const svg = await upload(owner, Buffer.from('<svg/>'), 'logo.svg', 'image/svg+xml');
    expect(svg.status).toBe(415);

    const html = await upload(owner, Buffer.from('<h1>hi</h1>'), 'page.html', 'text/html');
    expect(html.status).toBe(415);
  });

  it('rejects a file whose declared type contradicts its extension', async () => {
    const response = await upload(owner, PDF, 'report.pdf', 'image/png');
    expect(response.status).toBe(415);
    expect(response.body.error.message).toMatch(/does not match|not accepted/i);
  });

  it('rejects a request with no file', async () => {
    const response = await owner.agent
      .post(`/api/grants/${grantId}/documents`)
      .set('x-csrf-token', owner.csrf)
      .field('docType', 'OTHER');
    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/choose a file/i);
  });

  it('rejects an empty file', async () => {
    const response = await upload(owner, Buffer.alloc(0), 'empty.pdf', 'application/pdf');
    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/empty/i);
  });

  it('rejects a file over the 10 MB limit', async () => {
    const oversized = Buffer.alloc(config.maxUploadBytes + 1024, 0x41);
    const response = await upload(owner, oversized, 'huge.pdf', 'application/pdf');
    expect(response.status).toBe(413);
    expect(response.body.error.message).toMatch(/10 MB/i);
  });

  it('accepts a real spreadsheet', async () => {
    const workbook = buildDemoXlsx('Ledger', [
      ['Category', 'Amount'],
      ['Supplies', 1200],
    ]);
    const response = await upload(owner, workbook, 'ledger.xlsx', XLSX_MIME);
    expect(response.status).toBe(201);
  });

  it('rejects bytes that only pretend to be a spreadsheet', async () => {
    // Starts with the ZIP local-header magic but has no real structure.
    const notAZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('fake')]);
    const response = await upload(owner, notAZip, 'ledger.xlsx', XLSX_MIME);
    expect(response.status).toBe(415);
  });

  it('rejects a real ZIP that is not an OOXML workbook', async () => {
    // Structurally valid ZIP, but missing xl/workbook.xml — e.g. a renamed
    // archive of arbitrary files wearing the .xlsx extension.
    const impostor = buildZip([{ name: 'payload.txt', data: Buffer.from('not a workbook') }]);
    const response = await upload(owner, impostor, 'ledger.xlsx', XLSX_MIME);
    expect(response.status).toBe(415);
  });

  it('rejects plain text wearing a PDF name and MIME type', async () => {
    const response = await upload(owner, Buffer.from('hello, definitely a pdf'), 'report.pdf', 'application/pdf');
    expect(response.status).toBe(415);
  });

  it('leaves no orphan file when validation fails', async () => {
    const before = countFiles(context.uploadsDir);
    await upload(owner, Buffer.from('nope'), 'script.sh', 'text/x-shellscript');
    expect(countFiles(context.uploadsDir)).toBe(before);
  });
});

describe('downloading evidence', () => {
  it('serves the original bytes with a safe disposition header', async () => {
    const uploaded = await upload(owner, PDF, 'Board Packet.pdf', 'application/pdf');
    const response = await owner.agent.get(`/api/grants/${grantId}/documents/${uploaded.body.id}/download`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment;');
    expect(response.headers['content-disposition']).toContain('Board Packet.pdf');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(response.body).equals(PDF)).toBe(true);
  });

  it('requires authentication', async () => {
    const uploaded = await upload(owner, PDF, 'Private.pdf', 'application/pdf');
    const request = (await import('supertest')).default;
    const response = await request(context.app).get(
      `/api/grants/${grantId}/documents/${uploaded.body.id}/download`,
    );
    expect(response.status).toBe(401);
  });

  it('returns 404 for a document id that belongs to another grant', async () => {
    const uploaded = await upload(owner, PDF, 'Elsewhere.pdf', 'application/pdf');
    const otherGrantId = (
      context.db.prepare('SELECT id FROM grants WHERE id <> ? AND archived = 0 LIMIT 1').get(grantId) as { id: string }
    ).id;
    const response = await owner.agent.get(`/api/grants/${otherGrantId}/documents/${uploaded.body.id}/download`);
    expect(response.status).toBe(404);
  });

  it('reports a missing file on disk without leaking the path', async () => {
    const uploaded = await upload(owner, PDF, 'Will vanish.pdf', 'application/pdf');
    const row = context.db.prepare('SELECT storage_key AS key FROM documents WHERE id = ?').get(uploaded.body.id) as {
      key: string;
    };
    fs.rmSync(path.join(context.uploadsDir, row.key));

    const response = await owner.agent.get(`/api/grants/${grantId}/documents/${uploaded.body.id}/download`);
    expect(response.status).toBe(404);
    expect(response.body.error.message).toMatch(/no longer available/i);
    expect(JSON.stringify(response.body)).not.toContain(context.uploadsDir);
  });
});

describe('deleting evidence', () => {
  it('removes the row and the file for a permitted role', async () => {
    const uploaded = await upload(owner, PDF, 'Removable.pdf', 'application/pdf');
    const row = context.db.prepare('SELECT storage_key AS key FROM documents WHERE id = ?').get(uploaded.body.id) as {
      key: string;
    };
    const filePath = path.join(context.uploadsDir, row.key);
    expect(fs.existsSync(filePath)).toBe(true);

    const response = await del(owner, `/api/grants/${grantId}/documents/${uploaded.body.id}`);
    expect(response.status).toBe(204);
    expect(context.db.prepare('SELECT id FROM documents WHERE id = ?').get(uploaded.body.id)).toBeUndefined();
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('denies a member without the delete capability, leaving the file intact', async () => {
    const uploaded = await upload(owner, PDF, 'Protected.pdf', 'application/pdf');
    const response = await del(member, `/api/grants/${grantId}/documents/${uploaded.body.id}`);
    expect(response.status).toBe(403);
    expect(context.db.prepare('SELECT id FROM documents WHERE id = ?').get(uploaded.body.id)).toBeDefined();
  });
});

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return count;
}
