# Visual Testing Guide

This document covers RTL visual regression testing for the Musaed web app.

## Overview

Visual tests use Playwright to capture and compare screenshots of the application in both LTR (English) and RTL (Arabic) layouts. Tests verify that:

- RTL layouts render correctly when Arabic locale is active
- `.mirror-rtl` icons are visually flipped via CSS `transform: scaleX(-1)`
- Layout direction changes are applied consistently across all pages

## Running Tests Locally

### Prerequisites

```bash
# Install Playwright browsers (one-time setup)
cd apps/web
pnpm exec playwright install chromium
```

### Run All Visual Tests

```bash
cd apps/web
pnpm exec playwright test --project=chromium
```

### Run Specific Test File

```bash
pnpm exec playwright test e2e/rtl-visual.spec.ts
```

### Run with UI Mode (Interactive Debugging)

```bash
pnpm exec playwright test --ui
```

### Generate Baseline Screenshots

First-time runs will generate baseline screenshots automatically. To regenerate all baselines:

```bash
# Delete existing baselines
rm -rf test-results/.results-snapshots/

# Run tests to generate fresh baselines
pnpm exec playwright test --project=chromium
```

## Test Results Location

- **HTML Report**: `apps/web/playwright-report/index.html`
- **Baseline Images**: `apps/web/test-results/.results-snapshots/`
- **Failed Diffs**: `apps/web/test-results/` (after test failures)

## Updating Baselines

### When to Update

Update baseline screenshots when:

- ✅ Intentional UI changes are made (new design, layout adjustments)
- ✅ Adding new visual elements that should be captured
- ✅ Fixing legitimate visual bugs
- ❌ NOT when tests fail due to unintended regressions (fix the code instead)

### How to Update

#### Option 1: Update Specific Test (Recommended)

```bash
# Run with -u flag to update snapshots for a specific test
pnpm exec playwright test --update-snapshots e2e/rtl-visual.spec.ts
```

#### Option 2: Update All Baselines

```bash
# Regenerate all baselines
pnpm exec playwright test --update-snapshots
```

#### Option 3: Manual Baseline Replacement

```bash
# 1. Delete existing baselines
rm -rf test-results/.results-snapshots/

# 2. Run tests to generate fresh baselines
pnpm exec playwright test --project=chromium

# 3. Review generated images in test-results/.results-snapshots/

# 4. Commit the updated baselines
git add test-results/.results-snapshots/
git commit -m "chore: update visual test baselines for [reason]"
```

### CI Baseline Updates

When CI visual tests fail due to intentional changes:

1. Download the `visual-snapshots` artifact from the CI run
2. Review the new screenshots to confirm they match expected changes
3. Copy the new baselines to your local `test-results/.results-snapshots/`
4. Run tests locally to verify they pass
5. Commit the updated baselines

## Test Structure

The RTL visual test suite (`e2e/rtl-visual.spec.ts`) includes:

### LTR Baseline Tests

- `ltr-homepage` - English homepage layout
- `ltr-library` - English library page
- `ltr-settings` - English settings modal

### RTL Visual Verification

- `rtl-homepage` - Arabic homepage layout
- `rtl-library` - Arabic library page
- `rtl-settings` - Arabic settings modal
- `mirror-rtl icons are transformed` - Verifies CSS transform on icons
- `sidebar has RTL layout` - Verifies sidebar direction
- `chat window has RTL layout` - Verifies chat window direction

### Comparison Tests

- `visually differ between LTR and RTL` - Ensures layouts are actually different

### Key Test IDs Required

Components under test must have these `data-testid` attributes:

- `[data-testid="sidebar"]` - Sidebar container
- `[data-testid="chat-window"]` - Chat window container

If tests fail with "locator not found", verify these test IDs exist in the target components.

## CI Integration

Visual tests run as a non-blocking job in CI (`continue-on-error: true`). This allows:

- Early detection of visual regressions
- Time to stabilize baselines without blocking merges
- Artifact upload for manual review

CI Job: `Visual Tests · RTL (Non-blocking)`

- Runs after `validate` job
- Uploads HTML report and snapshots as artifacts
- Does NOT block PR merges (initially)

### Remove Non-Blocking Status

Once baselines stabilize, remove `continue-on-error: true` from `.github/workflows/ci.yml` to make visual tests required:

```yaml
visual-tests:
  name: Visual Tests · RTL
  runs-on: ubuntu-latest
  needs: validate
  # remove: continue-on-error: true
```

## Troubleshooting

### "Locator not found" Errors

Components may not have the required `data-testid` attributes. Add them:

```tsx
<div data-testid="sidebar">...</div>
<div data-testid="chat-window">...</div>
```

### "Screenshot comparison failed"

1. Check if the diff is expected (intentional UI change)
2. Compare pixel differences in the HTML report
3. Adjust tolerances in `playwright.config.ts` if needed:

   ```ts
   expect: {
     toHaveScreenshot: {
       maxDiffPixels: 50,    // Increase if false positives
       maxDiffPixelRatio: 0.05, // Or increase ratio
     },
   }
   ```

### Tests Timeout

Increase timeout in `playwright.config.ts`:

```ts
timeout: 120000, // Increase from 60000
expect: {
  timeout: 30000, // Increase from 15000
}
```

### Hydration Issues

Tests wait for `[dir]` selector to ensure DirectionProvider has synced. If tests fail during hydration:

```ts
await page.waitForSelector('[dir]', { state: 'visible' });
await page.waitForTimeout(2000); // Increase if needed
```

## Best Practices

1. **Use light theme** for consistent screenshots (set in test via localStorage)
2. **Wait for stability** - animations and CSS transforms need time to settle
3. **Review diffs visually** - pixel matching can produce false positives
4. **Commit baselines** - always include baseline updates in PRs with UI changes
5. **Test critical paths** - focus on user-facing layouts, not every component

## Related Files

- `e2e/rtl-visual.spec.ts` - Test suite
- `playwright.config.ts` - Configuration
- `src/app/globals.css` - RTL CSS rules (`.mirror-rtl`)
- `src/components/ui/DirectionProvider.tsx` - RTL direction logic
- `src/lib/i18n.ts` - Translation and locale management
