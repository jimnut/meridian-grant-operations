import { expect, test, type Page } from '@playwright/test';

import { ACCOUNTS, signIn } from './helpers';

/** True when the currently focused element sits inside the given container. */
async function focusIsInside(page: Page, containerSelector: string): Promise<boolean> {
  return page.evaluate(
    (selector) => Boolean(document.activeElement?.closest(selector)),
    containerSelector,
  );
}

/*
 * The playwright config maps only mobile.spec.ts to the mobile project, so
 * this file runs on the desktop project; the drawer tests set the mobile
 * viewport explicitly instead.
 */
test.describe('mobile navigation drawer', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens as a modal: focus moves in, Tab is trapped, Escape restores the trigger', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner);

    const hamburger = page.getByRole('button', { name: 'Open navigation' });
    await hamburger.click();

    // Focus lands on the drawer's own close button and the page is inert.
    await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();
    await expect(page.locator('.main')).toHaveAttribute('inert', '');

    // Tab cycles within the drawer only (more presses than it has focusables,
    // so the cycle provably wraps instead of escaping into the page).
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInside(page, '.sidebar'), `tab stop ${i} stays inside the drawer`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(page.locator('.sidebar')).toHaveAttribute('data-open', 'false');
    await expect(page.locator('.main')).not.toHaveAttribute('inert', '');
    await expect(hamburger).toBeFocused();
  });

  test('closed drawer contents are unreachable', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner);

    // Closed, the off-canvas sidebar is inert: not tabbable, not focusable.
    await expect(page.locator('.sidebar')).toHaveAttribute('inert', '');

    const focusable = await page.evaluate(() => {
      const link = document.querySelector<HTMLElement>('.sidebar .nav__item');
      link?.focus();
      return document.activeElement === link;
    });
    expect(focusable, 'a drawer link accepts focus while closed').toBe(false);

    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInside(page, '.sidebar'), `tab stop ${i} reached the closed drawer`).toBe(false);
    }
  });

  test('internal close button closes the drawer and returns focus', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner);

    const hamburger = page.getByRole('button', { name: 'Open navigation' });
    await hamburger.click();
    await page.getByRole('button', { name: 'Close menu' }).click();

    await expect(page.locator('.sidebar')).toHaveAttribute('data-open', 'false');
    await expect(page.locator('.sidebar')).toHaveAttribute('inert', '');
    await expect(hamburger).toBeFocused();
  });

  test('scrim click still closes the drawer', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner);

    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('.sidebar')).toHaveAttribute('data-open', 'true');

    // The 268px drawer covers the scrim's centre; click the exposed strip.
    await page.locator('.scrim').click({ position: { x: 350, y: 420 } });
    await expect(page.locator('.sidebar')).toHaveAttribute('data-open', 'false');
  });
});

test.describe('command palette', () => {
  test('opens with the keyboard shortcut, traps Tab, and Escape restores focus', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner);

    // Give a known element focus so the restore is observable.
    const searchButton = page.getByRole('button', { name: 'Search', exact: true });
    await searchButton.focus();

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Search Meridian' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('combobox')).toBeFocused();
    await expect(page.locator('#root')).toHaveAttribute('inert', '');

    // With an empty query the palette lists the input plus seven page links;
    // more presses than that proves Tab wraps rather than escaping.
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInside(page, '.palette'), `tab stop ${i} stays inside the palette`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
    await expect(searchButton).toBeFocused();
  });

  test('shows a loading state while a search is in flight, then results', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner);

    // Hold the search response until the loading state has been observed.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/search**', async (route) => {
      await gate;
      await route.continue();
    });

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Search Meridian' });
    await palette.getByRole('combobox').fill('Family');
    await expect(palette.getByText('Searching…')).toBeVisible();

    release();
    await expect(palette.getByRole('option', { name: /Family Stability Navigators/ })).toBeVisible();
    await expect(palette.getByText('Searching…')).toHaveCount(0);
  });

  test('search failure shows an honest error state with a working retry', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner);

    let fail = true;
    await page.route('**/api/search**', async (route) => {
      if (fail) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Search index unavailable' } }),
        });
        return;
      }
      await route.continue();
    });

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Search Meridian' });
    await palette.getByRole('combobox').fill('Family');

    await expect(palette.getByText(/Search is unavailable right now/)).toBeVisible();

    fail = false;
    await palette.getByRole('button', { name: 'Retry' }).click();
    await expect(palette.getByRole('option', { name: /Family Stability Navigators/ })).toBeVisible();
    await expect(palette.getByText(/Search is unavailable right now/)).toHaveCount(0);
  });

  test('detail breadcrumbs show the record name once it loads', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner);
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });

    await page.goto('/grants');
    await page.getByRole('link', { name: 'Family Stability Navigators' }).click();
    await expect(page.getByRole('heading', { name: 'Family Stability Navigators', level: 1 })).toBeVisible();
    await expect(crumbs.getByText('Family Stability Navigators')).toBeVisible();

    await page.goto('/funders');
    await page.getByRole('link', { name: 'Alder Point Foundation' }).first().click();
    await expect(page.getByRole('heading', { name: 'Alder Point Foundation', level: 1 })).toBeVisible();
    await expect(crumbs.getByText('Alder Point Foundation')).toBeVisible();
  });
});
