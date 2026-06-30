import { Context } from 'hono';
import { ContentfulStatusCode } from 'hono/utils/http-status';
import { Constants } from '../constants';
import { getBranding } from './branding';

export const faviconRoute = async (c: Context) => {
  const branding = getBranding(c);
  try {
    const faviconUrl = new URL(branding.favicon);
    if (c.env.ASSETS && Constants.ASSETS_DOMAIN_LIST.includes(faviconUrl.hostname)) {
      const response = await c.env.ASSETS.fetch(
        new Request(faviconUrl.toString(), { method: 'GET' })
      );
      const body = await response.arrayBuffer();
      return c.body(body, response.status as ContentfulStatusCode, {
        'Content-Type': 'image/vnd.microsoft.icon',
        'Content-Length': response.headers.get('Content-Length') || body.byteLength.toString()
      });
    }

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
