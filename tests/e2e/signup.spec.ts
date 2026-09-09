import { expect, test, type Page } from '@playwright/test';

import { ACCOUNTS, expectNoHorizontalOverflow, signIn } from './helpers';

const STAMP = Date.now();
const EMAIL = `e2e-owner-${STAMP}@example.org`;
const PASSWORD = 'e2e-password-long-enough';
const ORG = `E2E Nonprofit ${STAMP}`;

test.describe.configure({ mode: 'serial' });

async function signInAsOwner(page: Page): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeAttached({ timeout: 20_000 });
}

test('a demo visitor can leave the shared session and start their own trial', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await expect(page.getByText('Public demo · sample nonprofit data')).toBeVisible();
  await page.getByRole('button', { name: 'Leave demo & start free trial' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
});

test('a failed demo sign-out preserves the session and the trial action can retry', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.route('**/api/auth/sign-out', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Try again', code: 'UNAVAILABLE', fields: {} } }) });
  });
  const startTrial = page.getByRole('button', { name: 'Leave demo & start free trial' });
  await startTrial.click();
  await expect(page.getByRole('alert')).toContainText('Could not leave the demo');
  await expect(page.getByRole('heading', { name: 'Good day, Dana' })).toBeVisible();
  await expect(startTrial).toBeEnabled();
  expect((await page.request.get('/api/auth/session')).status()).toBe(200);
  await page.unroute('**/api/auth/sign-out');
  await startTrial.click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
});

test('the pricing page leads into a working sign-up that lands on an empty workspace with onboarding', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Priced for teams');
  await expect(page.getByText('$179').first()).toBeVisible();
  await expect(page.getByText('Most teams start here')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('link', { name: 'Start free trial' }).nth(1).click();
  await expect(page).toHaveURL(/\/signup/);

  await page.getByLabel('Your name').fill('E2E Owner');
  await page.getByLabel('Work email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Organization name').fill(ORG);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page.getByRole('heading', { name: /Good day, E2E/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Set up your workspace')).toBeVisible();
  await expect(page.getByText(/0 active awards/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('the sample portfolio, trial status, plan cards and calendar feed all work', async ({ page }) => {
  await signInAsOwner(page);
  await page.getByRole('button', { name: 'Load a sample portfolio' }).click();
  await expect(page.getByText('Sample portfolio loaded', { exact: false })).toBeVisible();
  await expect(page.getByText(/needs? a decision/)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Plan & billing' }).click();
  await expect(page.getByText(/Free trial · \d+ days? left/)).toBeVisible();
  await expect(page.getByText('Most popular')).toBeVisible();
  await expect(page.getByRole('link', { name: /Email us to activate Growth/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Calendar feed' }).click();
  await page.getByRole('button', { name: 'Create calendar link' }).click();
  const address = page.getByLabel('Calendar feed address');
  await expect(address).toHaveValue(/\/feeds\/[A-Za-z0-9]+\.ics$/);
  const feedPath = new URL(await address.inputValue()).pathname;
  const feed = await page.request.get(feedPath);
  expect(feed.status()).toBe(200);
  expect(await feed.text()).toContain('BEGIN:VEVENT');
});

test('an owner can create an invite link and a teammate can join through it', async ({ page, browser }) => {
  await signInAsOwner(page);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Team' }).click();
  await page.getByLabel('Role').selectOption('VIEWER');
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Invitation link ready' })).toBeVisible();
  const invitePath = new URL(await dialog.getByLabel('Link').inputValue()).pathname;

  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(invitePath);
  await expect(guest.getByRole('heading', { name: `Join ${ORG}` })).toBeVisible();
  await guest.getByLabel('Your name').fill('Board Treasurer');
  await guest.getByLabel('Work email').fill(`e2e-viewer-${STAMP}@example.org`);
  await guest.getByLabel('Password', { exact: true }).fill('viewer-password-long');
  await guest.getByRole('button', { name: `Join ${ORG}` }).click();
  await expect(guest.getByRole('heading', { name: /Good day, Board/ })).toBeVisible({ timeout: 20_000 });
  // Viewers see, but the create control is absent.
  await guest.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Grants' }).click();
  await expect(guest.getByRole('heading', { name: 'Grants', level: 1 })).toBeVisible();
  await expect(guest.getByRole('button', { name: 'New grant' })).toHaveCount(0);
  await context.close();

  await page.reload();
  await expect(page.getByText(`e2e-viewer-${STAMP}@example.org`)).toBeVisible();
});

test('the spreadsheet import creates grants with a mapped preview', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/grants/import');
  await page.getByLabel('Or paste the rows here').fill(
    ['Grant title,Funder,Status,Awarded amount,Period start,Period end,Next report due', `Imported Grant ${STAMP},Imported Funder,Awarded,12000,2026-07-01,2027-06-30,2026-12-15`].join('\n'),
  );
  await expect(page.getByText('Found 1 data row')).toBeVisible();
  await expect(page.getByLabel('Grant title')).toHaveValue('Grant title');
  await expect(page.getByLabel('Funder', { exact: true })).toHaveValue('Funder');
  await page.getByRole('button', { name: 'Import 1 row' }).click();
  await expect(page.getByText('1 created · 0 skipped · 0 with problems', { exact: false })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: `Imported Grant ${STAMP}` }).click();
  await expect(page.getByRole('heading', { name: `Imported Grant ${STAMP}`, level: 1 })).toBeVisible();
});
