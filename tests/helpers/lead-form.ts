import type { Server } from 'node:http';
import request from 'supertest';
import { LEAD_FORM_COOKIE } from '../../server/lib/lead-abuse';

export async function loadLeadForm(app: Server, page = '/contact') {
  const response = await request(app).get(page);
  const token = response.text.match(/name="formToken" value="([^"]+)"/)?.[1];
  const cookie = (response.headers['set-cookie'] as unknown as string[] ?? [])
    .find((value) => value.startsWith(`${LEAD_FORM_COOKIE}=`))?.split(';')[0];
  if (!token || !cookie) throw new Error('Form token or browser cookie missing');
  return { token, cookie, response };
}
