import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { config } from '../config';
import { recordLeadMailDeliveryEvent, RESEND_DELIVERY_TYPES } from '../lib/lead-mail-events';

/** Svix HMAC-SHA256 over exact bytes, with a five-minute replay tolerance. */
export function verifyResendWebhook(body: Buffer, id: string, timestamp: string, signatures: string,
  secret: string, now = Date.now()): boolean {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret) || !id || id.length > 256
    || !/^\d{1,12}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300
    || signatures.length > 4096) return false;
  const key = Buffer.from(secret.slice(6), 'base64');
  if (key.length < 16) return false;
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body).digest();
  return signatures.split(' ').some((part) => {
    if (!part.startsWith('v1,')) return false;
    const candidate = Buffer.from(part.slice(3), 'base64');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  });
}

const payloadSchema = z.object({
  type: z.enum(RESEND_DELIVERY_TYPES),
  created_at: z.string().datetime({ offset: true }),
  data: z.object({
    email_id: z.string().min(1).max(128),
    to: z.tuple([z.string().email().max(320)]),
    failed: z.object({ reason: z.string().max(1000) }).optional(),
  }),
});

export function resendWebhookHandler(req: Request, res: Response): void {
  if (!config.resendWebhookSecret) { res.status(503).json({ error: 'Webhook unavailable' }); return; }
  const body: unknown = req.body;
  if (!Buffer.isBuffer(body) || !verifyResendWebhook(body, req.get('svix-id') ?? '',
    req.get('svix-timestamp') ?? '', req.get('svix-signature') ?? '', config.resendWebhookSecret)) {
    res.status(400).json({ error: 'Invalid webhook' }); return;
  }
  let value: unknown;
  try { value = JSON.parse(body.toString('utf8')); } catch { res.status(400).json({ error: 'Invalid webhook' }); return; }
  const event = payloadSchema.safeParse(value);
  if (!event.success || Date.parse(event.data.created_at) > Date.now() + 300_000) {
    res.status(400).json({ error: 'Invalid event' }); return;
  }
  recordLeadMailDeliveryEvent(req.db, { id: req.get('svix-id')!, providerId: event.data.data.email_id,
    recipient: event.data.data.to[0], type: event.data.type, occurredAt: Date.parse(event.data.created_at),
    reason: event.data.data.failed?.reason });
  res.json({ received: true });
}
