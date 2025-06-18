import { Hono } from 'hono';
import { trimTrailingSlash } from 'hono/trailing-slash';

export const assets = new Hono();

assets.use(trimTrailingSlash());

// Match logo URLs
// Example: /logos/fxtwitter.svg
assets.get('/logos/*', c => {
  if (!c.env.ASSETS) {
    return c.notFound();
  }

  return c.env.ASSETS.fetch(c.req.url, c.req.raw);
});
