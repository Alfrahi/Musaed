import { test, expect, type Page } from '@playwright/test';

/**
 * RTL Visual Regression Tests
 *
 * These tests verify that RTL layouts render correctly when Arabic locale is active,
 * comparing screenshots against baseline images to detect unintended visual regressions.
 *
 * Baseline images are stored in: test-results/.results-snapshots/
 */

test.describe('RTL Visual Regression', () => {
  // Store page references for consistent access
  let page: Page;

  test.beforeEach(({ page: p }) => {
    page = p;
  });

  /**
   * Helper: Wait for app hydration and UI stability
   * DirectionProvider needs time to sync dir attribute
   */
  const waitForAppStable = async () => {
    // Wait for the main app to hydrate
    await page.waitForSelector('[dir]', { state: 'visible' });
    // Give time for CSS transforms and animations to settle
    await page.waitForTimeout(2000);
  };

  /**
   * Helper: Navigate to a specific page/route
   */
  const navigateTo = async (route: string) => {
    await page.goto(route);
    await waitForAppStable();
  };

  /**
   * Helper: Set locale via localStorage and reload
   * The settings store reads from localStorage on hydration
   */
  const setLocale = async (locale: 'en' | 'ar') => {
    await page.evaluate((lang: string) => {
      localStorage.setItem(
        'musaed-settings',
        JSON.stringify({
          language: lang,
          theme: 'light', // Use light theme for consistent screenshots
          fontSize: 'medium',
          enterToSend: true,
        })
      );
    }, locale);
    await page.reload({ waitUntil: 'networkidle' });
    await waitForAppStable();
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
      await expect(page).toHaveScreenshot(`${name}.png`, {
        ...options,
        fullPage,
      });
    }
  };

  test.describe('LTR Baseline Screenshots', () => {
    test.beforeEach(async () => {
      await navigateTo('/');
      await setLocale('en');
    });

    test('should capture LTR homepage baseline', async () => {
      // Verify LTR direction
      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe('ltr');

      await takeSnapshot({ name: 'ltr-homepage', fullPage: true });
    });

    test('should capture LTR library baseline', async () => {
      await navigateTo('/library');

      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe('ltr');

      await takeSnapshot({ name: 'ltr-library', fullPage: true });
    });

    test('should capture LTR settings baseline', async () => {
      await navigateTo('/settings');

      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe('ltr');

      await takeSnapshot({ name: 'ltr-settings', fullPage: true });
    });
  });

  test.describe('RTL Visual Verification', () => {
    test.beforeEach(async () => {
      await navigateTo('/');
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
      await navigateTo('/library');

      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe('rtl');

      await takeSnapshot({ name: 'rtl-library', fullPage: true });
    });

    test('should capture RTL settings screenshot', async () => {
      await navigateTo('/settings');

      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe('rtl');

      await takeSnapshot({ name: 'rtl-settings', fullPage: true });
    });

    test('should verify mirror-rtl icons are transformed', async () => {
      await navigateTo('/');

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
      await navigateTo('/');

      const sidebar = page.locator('[data-testid="sidebar"]');
      const sidebarDir = await sidebar.evaluate(
        (el: HTMLElement) => window.getComputedStyle(el).direction
      );

      expect(sidebarDir).toBe('rtl');

      await takeSnapshot({ name: 'rtl-sidebar', target: 'sidebar' });
    });

    test('should verify chat window has RTL layout', async () => {
      await navigateTo('/');

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
      await navigateTo('/');
      await setLocale('en');
      const ltrScreenshot = await page.screenshot();

      // Take RTL screenshot
      await navigateTo('/');
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
