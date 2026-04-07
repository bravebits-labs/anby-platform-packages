/**
 * Preview mode helpers for Anby apps.
 *
 * The shell's iframe page appends `?_preview=employee` to an embedded app's
 * URL whenever the logged-in CEO is running "View as employee" from the
 * dashboard header. Apps opt in by calling `isPreviewMode(request)` in
 * their loader (or framework equivalent) and hiding admin controls when
 * it returns `true`.
 *
 * Phase 1 is intentionally advisory: nothing is enforced server-side, so
 * a misbehaving or legacy app still works — it just won't honor preview.
 * Phase 2 will flip this into a real role check once auth-service grows
 * a proper role system.
 */

const PREVIEW_QUERY_KEY = '_preview';

export type PreviewMode = 'employee' | null;

/**
 * Read the preview signal from any object with a URL-shaped string on it
 * (Fetch API Request, Next.js NextRequest, Remix LoaderFunctionArgs.request,
 * etc.). Returns `'employee'` when the shell is asking the app to render
 * as a non-admin, otherwise `null`.
 */
export function getPreviewModeFromRequest(
  request: { url: string } | URL | string,
): PreviewMode {
  let url: URL;
  try {
    if (typeof request === 'string') {
      url = new URL(request);
    } else if (request instanceof URL) {
      url = request;
    } else {
      url = new URL(request.url);
    }
  } catch {
    return null;
  }
  return url.searchParams.get(PREVIEW_QUERY_KEY) === 'employee'
    ? 'employee'
    : null;
}

export function isPreviewMode(
  request: { url: string } | URL | string,
): boolean {
  return getPreviewModeFromRequest(request) === 'employee';
}
