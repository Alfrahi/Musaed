import { test, expect, type Page } from '@playwright/test';

/**
 * RTL Visual Regression Tests
 *
 * These tests verify that RTL layouts render correctly when Arabic locale is active,
 * comparing screenshots against baseline images to detect unintended visual regressions.
 *
 * Baseline images are stored in: e2e/rtl-visual.spec.ts-snapshots/
 */

test.describe('RTL Visual Regression', () => {
  // Store page references for consistent access
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;

    // Stub the Ollama health check so the connection status indicator renders
    // deterministically across environments (CI has no Ollama running, which
    // would otherwise show a red "Offline" + "Retry" state and pollute the
    // full-page screenshots with environment-dependent pixels).
    await p.route('**/api/tags', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ models: [] }),
      })
    );
  });

  /**
   * Helper: Wait for app hydration and UI stability
   * DirectionProvider needs time to sync dir attribute from settings store
   */
  const waitForAppStable = async (expectedDir?: 'ltr' | 'rtl') => {
    // Wait for store hydration to complete (isHydrated = true).
    // The app sets window.__MUSAED_HYDRATED__ = true when hydration completes.
    // This must be awaited on EVERY page load (including full reloads).
    await page.waitForFunction(() => (window as any).__MUSAED_HYDRATED__ === true, {
      timeout: 30000,
    });

    // Then wait for dir attribute to be set on html element
    await page.waitForSelector('html[dir]', { state: 'attached', timeout: 15000 });

    // If expectedDir is provided, verify the value matches
    if (expectedDir) {
      await page.waitForFunction((dir) => document.documentElement.dir === dir, expectedDir, {
        timeout: 15000,
      });
    }

    // Wait for the dynamically-imported chat window to finish loading on the
    // homepage. Its `ssr: false` loading fallback renders an `animate-spin`
    // spinner that would otherwise still be animating when the screenshot is
    // taken, producing an oscillating pixel diff. The library/settings routes
    // render their own dialogs instead, so this wait is homepage-only.
    const path = new URL(page.url()).pathname;
    if (path === '/' || path === '') {
      await page.waitForSelector('[data-testid="chat-window"]', {
        state: 'attached',
        timeout: 15000,
      });
    }

    // Give time for CSS transforms and animations to settle
    await page.waitForTimeout(2000);
  };

  /**
   * Helper: Navigate to a specific page/route
   * Uses domcontentloaded to avoid hanging on client-side navigation
   */
  const navigateTo = async (route: string, expectedDir?: 'ltr' | 'rtl') => {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for hydration and direction to be applied
    await waitForAppStable(expectedDir);
  };

  /**
   * Helper: Set locale via localStorage and reload
   * The settings store reads from Zustand persist storage (musaed-settings-storage)
   * with format: { state: { globalSettings: {...} }, version: 5 }
   */
  const setLocale = async (locale: 'en' | 'ar') => {
    await page.evaluate((lang: string) => {
      const defaultSettings = {
        // Deprecated sampling shell (audit F-3) - required by Rust serde
        temperature: 0.7,
        topK: 40,
        topP: 0.9,
        numPredict: 2048,
        numCtx: 4096,
        stop: [] as string[],
        systemPrompt: '',
        ollamaUrl: 'http://localhost:11434',
        language: lang,
        theme: 'system',
        // Set to true so useSettingsInitialization does NOT re-detect the
        // system language and overwrite our test locale.
        hasDetectedLanguage: true,
        enterToSend: true,
        chatRetentionDays: 0,
        enableLatex: false,
        enableMermaid: true,
        density: 1.0,
        sidebarWidth: 260,
        sidebarCollapsed: false,
        closeToTray: true,
        showTokenIndicator: true,
      };
      localStorage.setItem(
        'musaed-settings-storage',
        JSON.stringify({
          state: { globalSettings: defaultSettings },
          version: 5,
        })
      );
    }, locale);
    await page.reload({ waitUntil: 'networkidle' });
    await waitForAppStable(locale === 'ar' ? 'rtl' : 'ltr');
  };

  /**
   * Helper: Take a screenshot with RTL-safe naming
   */
  const takeSnapshot = async ({
    name,
    fullPage = false,
    target,
  }: {
    name: string;
    fullPage?: boolean;
    target?: 'page' | 'sidebar' | 'chat';
  }) => {
    const options = {
      maxDiffPixels: 50,
      maxDiffPixelRatio: 0.05,
    };

    if (target === 'sidebar') {
      const sidebar = page.locator('[data-testid="sidebar"]');
      await expect(sidebar).toBeVisible();
      await expect(sidebar).toHaveScreenshot(`${name}-sidebar.png`, options);
    } else if (target === 'chat') {
      const chat = page.locator('[data-testid="chat-window"]');
      await expect(chat).toBeVisible();
      await expect(chat).toHaveScreenshot(`${name}-chat.png`, options);
    } else {
      // Mask the Ollama connection status: its response-time readout
      // (`(NNms)`) is non-deterministic and irrelevant to RTL layout, so it
      // would otherwise cause cross-environment pixel diffs.
      const mask = [page.locator('[data-testid="ollama-connection-status"]')];
      await expect(page).toHaveScreenshot(`${name}.png`, {
        ...options,
        fullPage,
        mask,
      });
    }
  };

  test.describe('LTR Baseline Screenshots', () => {
    test.beforeEach(async () => {
      await navigateTo('/', 'ltr');
      await setLocale('en');
    });

    test('should capture LTR homepage baseline', async () => {
      // Verify LTR direction
      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe('ltr');

      await takeSnapshot({ name: 'ltr-homepage', fullPage: true });
    });

    test('should capture LTR library baseline', async () => {
      await navigateTo('/library', 'ltr');

      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe('ltr');

      await takeSnapshot({ name: 'ltr-library', fullPage: true });
    });

    test('should capture LTR settings baseline', async () => {
      await navigateTo('/settings', 'ltr');

      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe('ltr');

      await takeSnapshot({ name: 'ltr-settings', fullPage: true });
    });
  });

  test.describe('RTL Visual Verification', () => {
    test.beforeEach(async () => {
      // Start with default LTR, then switch to Arabic
      await navigateTo('/', 'ltr');
      await setLocale('ar');
    });

    test('should capture RTL homepage screenshot', async () => {
      // Verify RTL direction
      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe('rtl');

      // Verify lang attribute
      const lang = await page.evaluate(() => document.documentElement.lang);
      expect(lang).toBe('ar');

      await takeSnapshot({ name: 'rtl-homepage', fullPage: true });
    });

    test('should capture RTL library screenshot', async () => {
      await navigateTo('/library', 'rtl');

      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe('rtl');

      await takeSnapshot({ name: 'rtl-library', fullPage: true });
    });

    test('should capture RTL settings screenshot', async () => {
      await navigateTo('/settings', 'rtl');

      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe('rtl');

      await takeSnapshot({ name: 'rtl-settings', fullPage: true });
    });

    test('should verify mirror-rtl icons are transformed', async () => {
      await navigateTo('/', 'rtl');

      // Find elements with mirror-rtl class
      const mirrorIcons = page.locator('.mirror-rtl');
      const count = await mirrorIcons.count();

      // Should have at least some mirrored icons
      expect(count).toBeGreaterThan(0);

      // Check that icons have the correct transform style
      for (let i = 0; i < Math.min(count, 3); i++) {
        const icon = mirrorIcons.nth(i);
        const transform = await icon.evaluate(
          (el: HTMLElement) => window.getComputedStyle(el).transform
        );

        // In RTL, transform should be matrix(-1, 0, 0, 1, 0, 0) or scaleX(-1)
        // This indicates horizontal flip
        expect(transform).toMatch(/matrix\(-1,\s*0,\s*0,\s*1/);
      }
    });

    test('should verify sidebar has RTL layout', async () => {
      await navigateTo('/', 'rtl');

      const sidebar = page.locator('[data-testid="sidebar"]');
      const sidebarDir = await sidebar.evaluate(
        (el: HTMLElement) => window.getComputedStyle(el).direction
      );

      expect(sidebarDir).toBe('rtl');

      await takeSnapshot({ name: 'rtl-sidebar', target: 'sidebar' });
    });

    test('should verify chat window has RTL layout', async () => {
      await navigateTo('/', 'rtl');

      const chat = page.locator('[data-testid="chat-window"]');
      const chatDir = await chat.evaluate(
        (el: HTMLElement) => window.getComputedStyle(el).direction
      );

      expect(chatDir).toBe('rtl');

      await takeSnapshot({ name: 'rtl-chat', target: 'chat' });
    });
  });

  test.describe('LTR vs RTL Comparison', () => {
    test('should visually differ between LTR and RTL layouts', async () => {
      // Take LTR screenshot
      await navigateTo('/', 'ltr');
      await setLocale('en');
      const ltrScreenshot = await page.screenshot();

      // Take RTL screenshot (switch locale to Arabic first)
      await setLocale('ar');
      const rtlScreenshot = await page.screenshot();

      // Screenshots should be different (RTL should have mirrored layout)
      expect(ltrScreenshot.equals(rtlScreenshot)).toBe(false);

      // Verify specific RTL indicators
      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe('rtl');

      // Check that floating elements are mirrored
      const scrollButton = page.locator('button[aria-label]');
      const scrollButtonCount = await scrollButton.count();
      expect(scrollButtonCount).toBeGreaterThan(0);

      const scrollButtonDir = await scrollButton
        .first()
        .evaluate((el: HTMLElement) => window.getComputedStyle(el).direction);
      expect(scrollButtonDir).toBe('rtl');
    });
  });
});
