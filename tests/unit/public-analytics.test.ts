import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/config', () => ({ config: { gaMeasurementId: 'G-SYNTHETIC1' } }));
import { injectAnalytics } from '../../server/lib/public-chrome';

type Listener = { callback: (event?: unknown) => void; once: boolean };
type Script = { async?: boolean; src?: string };
interface HarnessOptions {
  url?: string;
  referrer?: string;
  navigator?: { globalPrivacyControl?: boolean; doNotTrack?: string };
  windowDoNotTrack?: string;
  targetIds?: string[];
  readyState?: 'loading' | 'complete';
}

/** Execute only our inline script; no browser or third-party code/network. */
function runTag(options: HarnessOptions = {}) {
  const location = new URL(options.url ?? 'https://grantconsole.com/pricing?email=synthetic-private@example.org#private-fragment');
  const listeners = new Map<string, Listener[]>();
  const scrolls: string[] = [];
  const appended: Array<{ script: Script; urlAtLoad: string }> = [];
  const targetIds = new Set(options.targetIds ?? []);
  const historyChanges: string[] = [];
  const document = {
    title: 'Synthetic private title never sent',
    referrer: options.referrer ?? 'https://referrer.example/private/account?token=synthetic-secret#private',
    readyState: options.readyState ?? 'loading',
    head: { appendChild(script: Script) { appended.push({ script, urlAtLoad: location.href }); } },
    createElement(tag: string): Script {
      expect(tag).toBe('script');
      return {};
    },
    getElementById(id: string) {
      return targetIds.has(id) ? { scrollIntoView() { scrolls.push(id); } } : null;
    },
    addEventListener(type: string, callback: Listener['callback'], options?: { once?: boolean }) {
      listeners.set(type, [...listeners.get(type) ?? [], { callback, once: options?.once === true }]);
    },
  };
  const context = {
    URL, location, document, navigator: options.navigator ?? {},
    doNotTrack: options.windowDoNotTrack,
    dataLayer: [] as Array<ArrayLike<unknown>>,
    history: {
      replaceState(_state: unknown, _title: string, path: string) {
        historyChanges.push(path);
        location.href = new URL(path, location).href;
      },
    },
  };
  const sandbox = Object.assign(context, { window: context });
  const html = injectAnalytics('<!--ANALYTICS-->');
  const script = html.match(/^<script>([\s\S]*)<\/script>$/)?.[1];
  expect(script).toBeTruthy();
  vm.runInNewContext(script!, sandbox, { timeout: 1000 });
  function dispatch(type: string, event?: unknown) {
    const current = listeners.get(type) ?? [];
    listeners.set(type, current.filter((listener) => !listener.once));
    current.forEach(({ callback }) => callback(event));
  }
  const calls = () => context.dataLayer.map((call) => Array.from(call));
  return { location, appended, scrolls, historyChanges, dispatch, calls };
}

describe('public analytics privacy and navigation', () => {
  it('sends one explicit page view with sanitized fields before loading the third-party tag', () => {
    const tag = runTag();
    const fields = { page_location: 'https://grantconsole.com/pricing', page_path: '/pricing', page_title: 'GrantConsole', page_referrer: 'https://referrer.example/' };
    expect(tag.calls().filter(([kind, event]) => kind === 'event' && event === 'page_view')).toEqual([['event', 'page_view', fields]]);
    expect(tag.calls()).toContainEqual(['config', 'G-SYNTHETIC1', { ...fields, send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false }]);
    expect(tag.appended).toEqual([{ script: { async: true, src: 'https://www.googletagmanager.com/gtag/js?id=G-SYNTHETIC1' }, urlAtLoad: 'https://grantconsole.com/pricing' }]);
    expect(JSON.stringify(tag.calls())).not.toMatch(/synthetic-private|synthetic-secret|private-fragment|Synthetic private title/);
    expect(tag.location.href).toBe('https://grantconsole.com/pricing');
  });

  it.each(['not a URL', 'javascript:synthetic-secret', 'file:///private/synthetic-secret'])('drops a non-web referrer: %s', (referrer) => {
    const event = runTag({ referrer }).calls().find(([kind, event]) => kind === 'event' && event === 'page_view');
    expect(event?.[2]).toMatchObject({ page_referrer: '' });
  });

  it.each([
    { navigator: { globalPrivacyControl: true } },
    { navigator: { doNotTrack: '1' } },
    { windowDoNotTrack: '1' },
  ])('respects privacy opt-out without loading a tag or altering navigation: %j', (options) => {
    const tag = runTag(options);
    expect(tag.appended).toEqual([]);
    expect(tag.calls()).toEqual([]);
    expect(tag.historyChanges).toEqual([]);
  });

  it('uses fixed CTA destinations and placements without link text, query strings or external URLs', () => {
    const tag = runTag();
    const click = (href: string, placement: string) => tag.dispatch('click', {
      target: { closest: () => ({ href, textContent: 'Synthetic private link text', closest: (selector: string) => selector === placement ? {} : null }) },
    });
    click('https://grantconsole.com/signup?email=synthetic-secret#private', 'header');
    click('https://grantconsole.com/downloads/grant-management-spreadsheet-template.xlsx?token=synthetic-secret', 'footer');
    click('https://external.example/signup?private=synthetic-secret', 'header');
    click('https://grantconsole.com/grants/private-record', 'content');
    expect(tag.calls().filter(([kind, event]) => kind === 'event' && event === 'cta_click')).toEqual([
      ['event', 'cta_click', { destination: 'trial', placement: 'header', page_path: '/pricing' }],
      ['event', 'cta_click', { destination: 'workbook', placement: 'footer', page_path: '/pricing' }],
    ]);
    expect(JSON.stringify(tag.calls())).not.toMatch(/synthetic-secret|private-record|private link text/);
  });

  it('scrolls to an existing decoded deep-link target after DOM readiness without restoring sensitive URL fields', () => {
    const tag = runTag({ url: 'https://grantconsole.com/?token=synthetic-secret#public%2Dfeatures', targetIds: ['public-features'] });
    expect(tag.scrolls).toEqual([]);
    expect(tag.location.href).toBe('https://grantconsole.com/');
    tag.dispatch('DOMContentLoaded');
    tag.dispatch('DOMContentLoaded');
    expect(tag.scrolls).toEqual(['public-features']);
    expect(tag.location.href).toBe('https://grantconsole.com/');
    expect(tag.historyChanges).toEqual(['/']);
    expect(JSON.stringify(tag.calls())).not.toMatch(/synthetic-secret|public-features/);
  });

  it.each(['missing-target', '%E0%A4%A'])('ignores missing or malformed anchor targets: %s', (fragment) => {
    const tag = runTag({ url: `https://grantconsole.com/#${fragment}`, targetIds: ['public-features'] });
    tag.dispatch('DOMContentLoaded');
    expect(tag.scrolls).toEqual([]);
    expect(tag.location.href).toBe('https://grantconsole.com/');
  });

  it('can preserve a valid anchor when the document is already ready', () => {
    const tag = runTag({ url: 'https://grantconsole.com/#features', targetIds: ['features'], readyState: 'complete' });
    expect(tag.scrolls).toEqual(['features']);
    expect(tag.location.hash).toBe('');
  });
});
