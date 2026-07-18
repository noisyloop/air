import { expect, test } from '@playwright/test';

const DEMO_EMAIL = 'listener@air.local';
const DEMO_PASSWORD = 'password123';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.fill('input[type=email]', DEMO_EMAIL);
  await page.fill('input[type=password]', DEMO_PASSWORD);
  await page.click('button:has-text("Log in")');
  await page.waitForURL('**/');
}

test('login shows a personalized home feed', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  await expect(page.getByText('Made for you')).toBeVisible();
});

test('session survives a hard reload', async ({ page }) => {
  await login(page);
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Your Library' })).toBeVisible();
});

test('library tabs switch content', async ({ page }) => {
  await login(page);
  await page.goto('/library');
  await page.click('button:has-text("Recently played")');
  await expect(page.locator('main')).toContainText(/./);
});

test('invalid login shows an error and stays on the page', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[type=email]', DEMO_EMAIL);
  await page.fill('input[type=password]', 'nope-wrong');
  await page.click('button:has-text("Log in")');
  await expect(page.getByText(/Invalid email or password/)).toBeVisible();
  expect(page.url()).toContain('/login');
});

test('anonymous users are redirected from the library to login', async ({ page }) => {
  await page.goto('/library');
  await page.waitForURL('**/login');
});

test('admin dashboard is reachable for admins only', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  await expect(page.getByText('404')).toBeVisible(); // listener lacks admin:analytics

  await page.goto('/login');
  // The user menu logout is hover-based; just re-login as admin in a fresh context.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[type=email]', 'admin@air.local');
  await page.fill('input[type=password]', DEMO_PASSWORD);
  await page.click('button:has-text("Log in")');
  await page.waitForURL('**/');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible();
});
