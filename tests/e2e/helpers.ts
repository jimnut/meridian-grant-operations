import { expect, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'GrantConsole!Demo2026';

export const ACCOUNTS = {
  owner: 'dana@riverbendalliance.org',
  manager: 'marcus@riverbendalliance.org',
  member: 'priya@riverbendalliance.org',
  viewer: 'tomas@riverbendalliance.org',
};

/**
 * Sign in through the real form, which also exercises validation and CSRF.
 * Waits for the authenticated shell — the sign-in page has its own <h1>, so a
 * generic heading check would return before the session exists.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeAttached({ timeout: 20_000 });
  await expect(page).not.toHaveURL(/\/signin/);
}

/** Fails if the page scrolls sideways — a common responsive regression. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(overflow.scrollWidth, 'page scrolls horizontally').toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/** A tiny but structurally valid PDF for upload tests. */
export function samplePdf(): Buffer {
  const content = 'BT /F1 12 Tf 72 720 Td (E2E evidence) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
