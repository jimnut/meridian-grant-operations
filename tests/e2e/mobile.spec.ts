import { expect, test } from '@playwright/test';

import { ACCOUNTS, expectNoHorizontalOverflow, signIn } from './helpers';

test('mobile sign-in and dashboard fit a 390px viewport', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await signIn(page, ACCOUNTS.owner);
  await expect(page.getByRole('heading', { name: /Good day/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('mobile navigation opens, navigates and closes', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);

  // The sidebar is off-canvas until the menu button is used.
  const grantsLink = page.getByRole('link', { name: 'Grants' });
  await expect(grantsLink).not.toBeInViewport();

  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(grantsLink).toBeInViewport();

  await grantsLink.click();
  await expect(page.getByRole('heading', { name: 'Grants', level: 1 })).toBeVisible();
  // Navigating closes the drawer again.
  await expect(grantsLink).not.toBeInViewport();
  await expectNoHorizontalOverflow(page);
});

test('mobile portfolio defaults to cards and keeps the full table available', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.goto('/grants');
  await expect(page.getByRole('heading', { name: 'Grants', level: 1 })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.board')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Table', exact: true }).click();
  const scrollable = await page.locator('.table-wrap').first().evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scrollable, 'wide table should scroll within its own wrapper').toBe(true);
});

test('mobile grant detail keeps tabs and controls usable', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.goto('/grants');
  await page.getByRole('link', { name: 'Family Stability Navigators' }).click();
  await expect(page.getByRole('heading', { name: 'Family Stability Navigators', level: 1 })).toBeVisible();

  await page.getByRole('tab', { name: /Budget/ }).click();
  await expect(page.getByRole('heading', { name: 'Budget lines' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('tab', { name: /Deliverables/ }).click();
  await expect(page.getByRole('heading', { name: 'Deliverables & reports' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('mobile dialogs stay within the viewport', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.goto('/grants');
  await expect(page.getByRole('heading', { name: 'Grants', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'New grant' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const box = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.width).toBeLessThanOrEqual(viewport.width);
  await expectNoHorizontalOverflow(page);
});

test('mobile calendar defaults to agenda and still offers a usable month grid', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
  // Phones land on the agenda list; the month grid stays one tap away.
  await expect(page.getByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Month' }).click();
  await expect(page.locator('.calendar__cell').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
