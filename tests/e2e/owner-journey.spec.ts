import { expect, test } from '@playwright/test';

import { ACCOUNTS, expectNoHorizontalOverflow, samplePdf, signIn } from './helpers';

const GRANT_TITLE = `Neighborhood Resilience Hubs ${Date.now()}`;

test.describe.configure({ mode: 'serial' });

test('owner signs in with a demo shortcut and sees a derived dashboard', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  // One-click demo login.
  await page.getByRole('button', { name: /Dana Whitfield · Owner/ }).click();

  await expect(page.getByRole('heading', { name: /Good day, Dana/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Active awarded value')).toBeVisible();
  await expect(page.getByText('Reporting readiness')).toBeVisible();

  // Figures are real currency amounts, not placeholders.
  const awarded = page.locator('.stat').filter({ hasText: 'Active awarded value' }).locator('.stat__value');
  await expect(awarded).toHaveText(/^\$[\d,]+\.\d{2}$/);

  // The attention queue explains itself.
  const attention = page.locator('.attention__item').first();
  await expect(attention).toBeVisible();
  await expect(attention.locator('.attention__reason')).not.toBeEmpty();

  await expectNoHorizontalOverflow(page);
});

test('owner creates a grant and it persists across a reload', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Grants' }).click();
  await expect(page.getByRole('heading', { name: 'Grants', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'New grant' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Validation fires before anything is written.
  await dialog.getByRole('button', { name: 'Create grant' }).click();
  await expect(dialog.getByText('Check the highlighted fields.')).toBeVisible();

  await dialog.getByLabel('Grant title').fill(GRANT_TITLE);
  await dialog.getByLabel('Program').fill('Community Resilience');
  await dialog.getByLabel('Funder', { exact: true }).selectOption({ label: 'Alder Point Foundation' });
  await dialog.getByLabel('Status').selectOption('AWARDED');
  await dialog.getByLabel('Requested amount').fill('250000');
  await dialog.getByLabel('Awarded amount').fill('225,000.50');
  await dialog.getByLabel('Internal owner').selectOption({ label: 'Dana Whitfield' });
  await dialog.getByLabel('Period start').fill('2026-07-01');
  await dialog.getByLabel('Period end').fill('2027-06-30');
  await dialog.getByRole('button', { name: 'Create grant' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(`“${GRANT_TITLE}” created.`)).toBeVisible();

  // Find it through search, proving it was persisted and indexed.
  await page.getByLabel('Search grants').fill(GRANT_TITLE);
  const row = page.getByRole('link', { name: GRANT_TITLE });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  await expect(page.getByRole('heading', { name: GRANT_TITLE, level: 1 })).toBeVisible();
  await expect(page.getByText('$225,000.50').first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: GRANT_TITLE, level: 1 })).toBeVisible();
  await expect(page.getByText('$225,000.50').first()).toBeVisible();
});

test('owner adds a task, deliverable, budget line, note and evidence', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.goto('/grants');
  await page.getByLabel('Search grants').fill(GRANT_TITLE);
  await page.getByRole('link', { name: GRANT_TITLE }).click();
  await expect(page.getByRole('heading', { name: GRANT_TITLE, level: 1 })).toBeVisible();

  // --- task
  await page.getByRole('tab', { name: /Tasks/ }).click();
  await page.getByRole('button', { name: 'Add task' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task', { exact: true }).fill('Confirm site agreements');
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await dialog.getByLabel('Due date').fill('2026-09-30');
  await dialog.getByRole('button', { name: 'Add task' }).click();
  await expect(page.locator('.list-row__title', { hasText: 'Confirm site agreements' })).toBeVisible();

  // Completing it persists. The checkbox is located by its row, because its
  // accessible name flips to “…not done” once the task is complete.
  const taskRow = page.locator('.list-row', { hasText: 'Confirm site agreements' });
  await taskRow.getByRole('checkbox').click();
  await expect(taskRow.getByRole('checkbox')).toBeChecked();

  await page.reload();
  await page.getByRole('tab', { name: /Tasks/ }).click();
  await expect(
    page.locator('.list-row', { hasText: 'Confirm site agreements' }).getByRole('checkbox'),
  ).toBeChecked();

  // --- deliverable
  await page.getByRole('tab', { name: /Deliverables/ }).click();
  await page.getByRole('button', { name: 'Add deliverable' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill('Mid-year narrative report');
  await dialog.getByLabel('Type').selectOption('REPORT');
  await dialog.getByLabel('Due date').fill('2026-12-15');
  await dialog.getByLabel('Required evidence').fill('2');
  await dialog.getByRole('button', { name: 'Add deliverable' }).click();
  await expect(page.locator('.table__primary', { hasText: 'Mid-year narrative report' })).toBeVisible();
  await expect(page.getByText('0 of 2 evidence items')).toBeVisible();
  // The header's next-deadline tile recalculates from the new deliverable.
  await expect(page.locator('.stat__helper', { hasText: 'Mid-year narrative report' })).toBeVisible();

  // --- budget
  await page.getByRole('tab', { name: /Budget/ }).click();
  await page.getByRole('button', { name: 'Add line' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Category').fill('Personnel');
  await dialog.getByLabel('Planned').fill('180000');
  await dialog.getByLabel('Spent to date').fill('42,500.25');
  await dialog.getByRole('button', { name: 'Add line' }).click();
  await expect(page.getByText('$42,500.25').first()).toBeVisible();
  // 180,000.00 planned − 42,500.25 spent, computed in integer cents.
  await expect(page.getByText('$137,499.75').first()).toBeVisible();

  // --- evidence upload
  await page.getByRole('tab', { name: /Evidence/ }).click();
  await page.getByLabel('File').setInputFiles({
    name: 'Q3 Board Report.pdf',
    mimeType: 'application/pdf',
    buffer: samplePdf(),
  });
  await page.getByLabel('Document type').selectOption('NARRATIVE');
  await page.getByLabel('Link to deliverable').selectOption({ label: 'Mid-year narrative report' });
  await page.getByRole('button', { name: 'Upload evidence' }).click();
  await expect(page.getByText('Evidence uploaded.')).toBeVisible();
  await expect(page.getByText('Q3 Board Report.pdf')).toBeVisible();

  // The evidence count on the deliverable moved.
  await page.getByRole('tab', { name: /Deliverables/ }).click();
  await expect(page.getByText('1 of 2 evidence items')).toBeVisible();

  // --- note
  await page.getByRole('tab', { name: /Notes/ }).click();
  await page.getByRole('textbox', { name: 'Note' }).fill('Site agreements confirmed with both partner congregations.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Site agreements confirmed with both partner congregations.')).toBeVisible();

  // --- activity trail recorded everything
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText(/Uploaded evidence/)).toBeVisible();
  await expect(page.getByText(/Added task/)).toBeVisible();
  await expect(page.getByText(/Added budget line/)).toBeVisible();
});

test('status change persists and is written to the audit trail', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.goto('/grants');
  await page.getByLabel('Search grants').fill(GRANT_TITLE);
  await page.getByRole('link', { name: GRANT_TITLE }).click();

  // Selecting a status stages it; the change applies only after an explicit
  // confirmation, and focus starts on Cancel so Enter-by-reflex is safe.
  await page.getByLabel('Lifecycle status').selectOption('REPORTING');
  const statusDialog = page.getByRole('dialog', { name: 'Change lifecycle status?' });
  await expect(statusDialog).toBeVisible();
  await expect(statusDialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await statusDialog.getByRole('button', { name: 'Change status' }).click();
  await expect(page.getByText('Status set to Reporting.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Lifecycle status')).toHaveValue('REPORTING');

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('Status changed from Awarded to Reporting')).toBeVisible();
});

test('reporting packet renders and the portfolio CSV downloads', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.goto('/grants');
  await page.getByLabel('Search grants').fill(GRANT_TITLE);
  await page.getByRole('link', { name: GRANT_TITLE }).click();

  await page.getByRole('link', { name: 'Reporting packet' }).click();
  await expect(page.getByRole('heading', { name: GRANT_TITLE })).toBeVisible();
  await expect(page.getByText('Grant reporting packet')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deliverables and evidence checklist' })).toBeVisible();
  // Listed in the evidence checklist and, separately, in the activity trail.
  await expect(page.locator('li', { hasText: 'Q3 Board Report.pdf — Narrative' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Uploaded evidence “Q3 Board Report\.pdf”/ })).toBeVisible();

  const packetDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const packetFile = await packetDownload;
  expect(packetFile.suggestedFilename()).toMatch(/^reporting-packet-.*\.csv$/);

  await page.goto('/grants');
  const portfolioDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const portfolioFile = await portfolioDownload;
  expect(portfolioFile.suggestedFilename()).toMatch(/^riverbend-grant-portfolio-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('archive is refused with a reason while obligations are open', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.goto('/grants');
  await page.getByLabel('Search grants').fill(GRANT_TITLE);
  await page.getByRole('link', { name: GRANT_TITLE }).click();

  // The journey grant is an active award with open work: instead of offering
  // the destructive action, the UI states the shared lifecycle rule.
  await page.getByRole('button', { name: 'Archive' }).click();
  const refusal = page.getByRole('dialog', { name: 'This grant cannot be archived yet' });
  // Match the explanation body, not the dialog title, to stay unambiguous.
  await expect(refusal.getByText(/Active awards cannot be archived|still has/)).toBeVisible();
  await refusal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(refusal).not.toBeVisible();
});

test('archive hides an eligible grant from the default portfolio and restores cleanly', async ({ page }) => {
  // Closed, fully resolved seeded grant — the record archiving is meant for.
  const CLOSED_TITLE = 'Emergency Shelter Winter Response';

  await signIn(page, ACCOUNTS.owner);
  await page.goto('/grants');
  await page.getByLabel('Search grants').fill(CLOSED_TITLE);
  await page.getByRole('link', { name: CLOSED_TITLE }).click();

  await page.getByRole('button', { name: 'Archive' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByText(/Nothing is deleted/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Archive grant' }).click();
  await expect(page.getByText('Grant archived.')).toBeVisible();

  await page.goto('/grants');
  await page.getByLabel('Search grants').fill(CLOSED_TITLE);
  await expect(page.getByText('No grants match these filters')).toBeVisible();

  await page.getByRole('checkbox', { name: 'Archived' }).check();
  await expect(page.getByRole('link', { name: CLOSED_TITLE })).toBeVisible();

  await page.getByRole('link', { name: CLOSED_TITLE }).click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore grant' }).click();
  await expect(page.getByText('Grant restored.')).toBeVisible();
});

test('calendar, funders and reports surfaces load with real records', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);

  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Agenda' }).click();
  await expect(page.locator('.list-row').first()).toBeVisible();

  await nav.getByRole('link', { name: 'Funders' }).click();
  await expect(page.getByRole('heading', { name: 'Funders', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Alder Point Foundation' }).first().click();
  await expect(page.getByRole('heading', { name: 'Alder Point Foundation', level: 1 })).toBeVisible();
  await expect(page.getByText('Helen Marchetti')).toBeVisible();

  await nav.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reporting readiness by grant' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('command palette finds a grant by name', async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.keyboard.press('Control+k');

  const palette = page.getByRole('dialog', { name: 'Search Meridian' });
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox').fill('Food Hub');
  await expect(palette.getByRole('option', { name: /Community Food Hub Expansion/ })).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Community Food Hub Expansion', level: 1 })).toBeVisible();
});
