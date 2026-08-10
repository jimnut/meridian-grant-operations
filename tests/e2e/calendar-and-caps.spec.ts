import { expect, test, type Page } from '@playwright/test';

import { ACCOUNTS, expectNoHorizontalOverflow, signIn } from './helpers';

/**
 * Calendar semantics and record-cap regressions:
 *  - the month grid is a real ARIA grid whose crowded days can be fully expanded;
 *  - the agenda renders every event in its 120-day window, uncapped;
 *  - phones land on the agenda view by default;
 *  - the board view reports the complete filtered portfolio;
 *  - the reporting packet stays inside a phone viewport.
 */

interface ApiSession {
  csrfToken: string;
  today: string;
}

async function apiSession(page: Page): Promise<ApiSession> {
  const response = await page.request.get('/api/auth/session');
  expect(response.ok(), 'session endpoint should respond for a signed-in page').toBe(true);
  const body = (await response.json()) as ApiSession;
  return { csrfToken: body.csrfToken, today: body.today };
}

/** Timezone-free day math over YYYY-MM-DD strings, mirroring shared/dates. */
function addDaysIso(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** "Tuesday, August 12, 2026" — the accessible label the month cells carry. */
function fullDateLabel(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

async function firstGrantId(page: Page, q = ''): Promise<string> {
  const query = q ? `&q=${encodeURIComponent(q)}` : '';
  const response = await page.request.get(`/api/grants?page=1&pageSize=5${query}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { items: Array<{ id: string }> };
  expect(body.items.length).toBeGreaterThan(0);
  return body.items[0]!.id;
}

async function createTask(page: Page, csrf: string, grantId: string, title: string, dueDate: string): Promise<string> {
  const response = await page.request.post(`/api/grants/${grantId}/tasks`, {
    headers: { 'x-csrf-token': csrf },
    data: { title, status: 'TODO', priority: 'MEDIUM', dueDate },
  });
  expect(response.status(), `task "${title}" should be created`).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function deleteTask(page: Page, csrf: string, grantId: string, taskId: string): Promise<void> {
  await page.request.delete(`/api/grants/${grantId}/tasks/${taskId}`, { headers: { 'x-csrf-token': csrf } });
}

test('month view reveals every event on a crowded day', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  const { csrfToken, today } = await apiSession(page);
  const grantId = await firstGrantId(page);

  // Guarantee a day with 4+ events regardless of what the seed put there.
  const target = addDaysIso(today, 10);
  const titles = [
    'E2E crowded day task one',
    'E2E crowded day task two',
    'E2E crowded day task three',
    'E2E crowded day task four',
  ];
  const taskIds: string[] = [];
  try {
    for (const title of titles) {
      taskIds.push(await createTask(page, csrfToken, grantId, title, target));
    }

    await page.goto('/calendar');
    await expect(page.getByRole('grid')).toBeVisible();
    // Weekday headers are real columnheaders with full names.
    await expect(page.getByRole('columnheader', { name: 'Sunday' })).toBeVisible();

    // The target day may fall in next month's grid.
    if (target.slice(0, 7) !== today.slice(0, 7)) {
      await page.getByRole('button', { name: 'Next month' }).click();
    }

    const cell = page.getByRole('gridcell', { name: fullDateLabel(target) });
    await expect(cell).toBeVisible();

    // Collapsed: only the three-event preview shows, plus a real button.
    await expect(cell.getByRole('link')).toHaveCount(3);
    const more = cell.getByRole('button', { name: /more deadlines/ });
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'false');

    // Keyboard-activate the disclosure, as a keyboard user would.
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(cell.getByRole('button', { name: /Show fewer/ })).toHaveAttribute('aria-expanded', 'true');

    // Every created event is now visible and reachable.
    for (const title of titles) {
      await expect(cell.getByRole('link', { name: title })).toBeVisible();
    }
    const lastEvent = cell.getByRole('link', { name: titles[3]! });
    await lastEvent.focus();
    await expect(lastEvent).toBeFocused();
  } finally {
    for (const taskId of taskIds) {
      await deleteTask(page, csrfToken, grantId, taskId);
    }
  }
});

test('agenda lists every event in the 120-day window', async ({ page }) => {
  test.setTimeout(120_000); // 70 tasks are created and removed through the API

  await signIn(page, ACCOUNTS.owner);
  const { csrfToken, today } = await apiSession(page);
  const grantId = await firstGrantId(page);

  // Push the agenda well past the old 60-item cap.
  const taskIds: string[] = [];
  try {
    for (let i = 0; i < 70; i += 1) {
      taskIds.push(
        await createTask(page, csrfToken, grantId, `E2E agenda filler ${i + 1}`, addDaysIso(today, 15 + (i % 90))),
      );
    }

    const to = addDaysIso(today, 120);
    const response = await page.request.get(`/api/calendar?from=${today}&to=${to}`);
    expect(response.ok()).toBe(true);
    const { events } = (await response.json()) as { events: unknown[] };
    expect(events.length).toBeGreaterThan(60);

    await page.goto('/calendar');
    await page.getByRole('button', { name: 'Agenda' }).click();
    await expect(page.getByText(`${events.length} upcoming deadlines`)).toBeVisible();
    await expect(page.locator('.list-row')).toHaveCount(events.length);
  } finally {
    for (const taskId of taskIds) {
      await deleteTask(page, csrfToken, grantId, taskId);
    }
  }
});

test('board view reports the complete filtered portfolio', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);

  const response = await page.request.get('/api/grants?page=1&pageSize=100');
  expect(response.ok()).toBe(true);
  const { total } = (await response.json()) as { total: number };

  await page.goto('/grants');
  // exact: the topbar search trigger's accessible name ends in "Keyboard",
  // which substring-matches "Board".
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByText(`Showing all ${total} grants`)).toBeVisible();

  // The per-column counts must add up to the honest total.
  const counts = await page.locator('.board__column-count').allTextContents();
  const sum = counts.reduce((acc, text) => acc + Number(text), 0);
  expect(sum).toBe(total);
});

test.describe('phone viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('calendar defaults to the agenda view on a phone', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner);
    await page.goto('/calendar');

    await expect(page.getByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Next 120 days' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The toggle still lets the user opt into the month grid.
    await page.getByRole('button', { name: 'Month' }).click();
    await expect(page.getByRole('grid')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('reporting packet stays inside the viewport', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner);
    const grantId = await firstGrantId(page, 'Family Stability');

    await page.goto(`/grants/${grantId}/packet`);
    await expect(page.getByText('Grant reporting packet')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Activity trail' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
