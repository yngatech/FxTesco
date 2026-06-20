import { Context } from 'hono';
import { ContentfulStatusCode } from 'hono/utils/http-status';
import { getBranding } from './branding';

export const faviconRoute = async (c: Context) => {
  const branding = getBranding(c);
  try {
    const response = await fetch(branding.favicon);
    const body = await response.arrayBuffer();
    return c.body(body, response.status as ContentfulStatusCode, {
      'Content-Type': response.headers.get('Content-Type') || 'image/x-icon',
      'Content-Length': response.headers.get('Content-Length') || body.byteLength.toString()
    });
  } catch (_e) {
    return c.redirect(branding.favicon, 302);
  }
};
