import { expect, test } from '@playwright/test';

import { ACCOUNTS, expectNoHorizontalOverflow, signIn } from './helpers';

test('viewer sees a read-only workspace with no write affordances', async ({ page }) => {
  await signIn(page, ACCOUNTS.viewer);

  await page.getByRole('link', { name: 'Grants' }).click();
  await expect(page.getByRole('heading', { name: 'Grants', level: 1 })).toBeVisible();

  // No create control anywhere on the portfolio.
  await expect(page.getByRole('button', { name: 'New grant' })).toHaveCount(0);
  // Export stays available — viewers can read and export.
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();

  await page.getByRole('link', { name: 'Family Stability Navigators' }).click();
  await expect(page.getByRole('heading', { name: 'Family Stability Navigators', level: 1 })).toBeVisible();
  await expect(page.getByText('You have read-only access to this workspace.')).toBeVisible();

  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByLabel('Lifecycle status')).toHaveCount(0);

  await page.getByRole('tab', { name: /Tasks/ }).click();
  await expect(page.getByRole('button', { name: 'Add task' })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);

  await page.getByRole('tab', { name: /Budget/ }).click();
  await expect(page.getByRole('button', { name: 'Add line' })).toHaveCount(0);

  await page.getByRole('tab', { name: /Evidence/ }).click();
  await expect(page.getByText('Your role can download evidence but cannot upload new files.')).toBeVisible();

  await page.getByRole('tab', { name: /Notes/ }).click();
  await expect(page.getByRole('button', { name: 'Add note' })).toHaveCount(0);
});

test('viewer cannot mutate even by calling the API directly', async ({ page }) => {
  await signIn(page, ACCOUNTS.viewer);

  const result = await page.evaluate(async () => {
    const sessionResponse = await fetch('/api/auth/session', { credentials: 'same-origin' });
    const session = await sessionResponse.json();
    const response = await fetch('/api/funders', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': session.csrfToken },
      body: JSON.stringify({ name: 'Should never exist', type: 'CORPORATE' }),
    });
    return { sessionStatus: sessionResponse.status, status: response.status, body: await response.json() };
  });

  expect(result.sessionStatus, 'the viewer should still be signed in').toBe(200);

  expect(result.status).toBe(403);
  expect(result.body.error.message).toMatch(/read-only/i);
});

test('viewer settings page is read-only but still informative', async ({ page }) => {
  await signIn(page, ACCOUNTS.viewer);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Organization name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Current period' })).toBeVisible();
  await expect(page.getByRole('term').filter({ hasText: /^Fiscal year$/ })).toBeVisible();
});

test('a foreign record shows a safe not-found page', async ({ page }) => {
  await signIn(page, ACCOUNTS.member);
  await page.goto('/grants/gr_thisdoesnotexist');
  await expect(page.getByText('Grant not found')).toBeVisible();
  await expect(page.getByText(/belongs to another organization/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to portfolio' })).toBeVisible();
});

test('unknown routes render the in-app not-found page', async ({ page }) => {
  await signIn(page, ACCOUNTS.member);
  await page.goto('/nowhere');
  await expect(page.getByText('That page does not exist')).toBeVisible();
});

test('signed-out visitors are redirected to sign-in', async ({ page }) => {
  await page.goto('/grants');
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('sign-in shows an inline error for bad credentials and never leaks which part was wrong', async ({ page }) => {
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(ACCOUNTS.owner);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('not recognised');
  await expect(page).toHaveURL(/\/signin$/);
});

test('keyboard users can skip to content and operate the dialog', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);

  // Reload so sequential focus navigation starts from the top of the document.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // Skip link is the first tab stop and moves focus to main.
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  // Dialogs trap focus and close on Escape, restoring focus to the trigger.
  await page.goto('/grants');
  const trigger = page.getByRole('button', { name: 'New grant' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Grant title')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('semantic landmarks, headings and accessible charts are present', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);

  await expect(page.locator('main#main-content')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

  // The donut chart is mirrored by a text summary and a screen-reader table.
  const healthCard = page.locator('.card').filter({ hasText: 'Portfolio health' });
  await expect(healthCard.locator('.chart-summary')).not.toBeEmpty();
  await expect(healthCard.locator('table caption')).toHaveText(/Active awards by health level/);

  // Status is never colour-only: each pill carries a text label.
  const pill = page.locator('.badge').first();
  await expect(pill).not.toBeEmpty();
});

test('every form control on the grant dialog has an associated label', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.goto('/grants');
  await page.getByRole('button', { name: 'New grant' }).click();

  const unlabelled = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return ['no dialog'];
    const controls = Array.from(dialog.querySelectorAll('input, select, textarea'));
    return controls
      .filter((el) => {
        const id = el.getAttribute('id');
        const hasLabel = id ? Boolean(dialog.querySelector(`label[for="${id}"]`)) : false;
        return !hasLabel && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby');
      })
      .map((el) => el.outerHTML.slice(0, 80));
  });

  expect(unlabelled).toEqual([]);
});

test('desktop layout has no horizontal overflow on any main page', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  for (const path of ['/', '/grants', '/funders', '/calendar', '/reports', '/team', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test('tablet layout has no horizontal overflow on any main page', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await signIn(page, ACCOUNTS.owner);
  for (const path of ['/', '/grants', '/funders', '/calendar', '/reports', '/team', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test('team page shows the permission matrix and role controls for an owner', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.goto('/team');

  await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What each role can do' })).toBeVisible();
  await expect(page.getByLabel('Role for Priya Raghunathan')).toBeVisible();
  await expect(page.getByRole('row', { name: /Tomás Herrera/ })).toBeVisible();
  // The matrix documents exactly what the server enforces.
  await expect(page.getByRole('row', { name: /Change organization settings/ })).toBeVisible();
});
