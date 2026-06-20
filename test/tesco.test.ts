import { afterEach, expect, test, vi } from 'vitest';
import { app } from '../src/worker';
import { botHeaders } from './helpers/data';
import harness from './helpers/harness';

afterEach(() => {
  vi.restoreAllMocks();
});

const mockTescoProductHtml = `<!doctype html>
<html>
  <head>
    <title>Fallback title - Tesco Groceries</title>
    <meta property="og:title" content="Tesco Finest Sea Salt & Chardonnay Vinegar Handcooked Crisps 150g">
    <meta property="og:description" content="Sea salt and Chardonnay wine vinegar flavour potato crisps.">
    <meta property="og:image" content="https://digitalcontent.api.tesco.com/v2/media/ghs/example.jpeg">
    <script type="application/ld+json">
      {
        "@type": "Product",
        "name": "Tesco Finest Sea Salt & Chardonnay Vinegar Handcooked Crisps 150g",
        "description": "Sea salt and Chardonnay wine vinegar flavour potato crisps.",
        "image": "https://digitalcontent.api.tesco.com/v2/media/ghs/example.jpeg",
        "brand": { "name": "Tesco Finest" },
        "offers": { "price": "1.5", "priceCurrency": "GBP" }
      }
    </script>
  </head>
  <body></body>
</html>`;

const mockTescoImageUrl = 'https://digitalcontent.api.tesco.com/v2/media/ghs/example.jpeg';
const proxiedMockTescoImageUrl = `https://www.fxtesco.com/image?url=${encodeURIComponent(mockTescoImageUrl)}`;

test('Tesco shop product URLs return Discord embed metadata', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url;
    expect(url).toBe('https://www.tesco.com/shop/en-GB/products/323311991');
    return new Response(mockTescoProductHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  });

  const result = await app.request(
    new Request('https://www.fxtesco.com/shop/en-GB/products/323311991', {
      method: 'GET',
      headers: botHeaders
    }),
    undefined,
    harness
  );
  const html = await result.text();

  expect(result.status).toBe(200);
  expect(result.headers.get('location')).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(html).toContain(
    '<meta property="og:title" content="Tesco Finest Sea Salt & Chardonnay Vinegar Handcooked Crisps 150g"/>'
  );
  expect(html).toContain(
    '<meta property="og:url" content="https://www.tesco.com/shop/en-GB/products/323311991"/>'
  );
  expect(html).toContain(`<meta property="og:image" content="${proxiedMockTescoImageUrl}"/>`);
  expect(html).toContain(
    "<link href='https://www.fxtesco.com/users/tesco/statuses/323311991?locale=en-GB' rel='alternate' type='application/activity+json'>"
  );
  expect(html).not.toContain('http-equiv="refresh"');
});

test('Tesco ActivityPub alternate returns Mastodon-shaped product JSON', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url;
    expect(url).toBe('https://www.tesco.com/shop/en-GB/products/323311991');
    return new Response(mockTescoProductHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  });

  const result = await app.request(
    new Request('https://www.fxtesco.com/users/tesco/statuses/323311991?locale=en-GB', {
      method: 'GET',
      headers: {
        ...botHeaders,
        Accept: 'application/activity+json'
      }
    }),
    undefined,
    harness
  );
  const body = (await result.json()) as ActivityStatus;

  expect(result.status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(body.id).toBe('323311991');
  expect(body.account.acct).toBe('tesco');
  expect(body.account.display_name).toBe('Tesco Finest on Tesco');
  expect(body.url).toBe('https://www.tesco.com/shop/en-GB/products/323311991');
  expect(body.content).toContain('£1.50');
  expect(body.media_attachments[0]?.url).toBe(proxiedMockTescoImageUrl);
});

test('Tesco groceries product URLs remain supported', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(mockTescoProductHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    })
  );

  const result = await app.request(
    new Request('https://www.fxtesco.com/groceries/en-GB/products/323311991', {
      method: 'GET',
      headers: botHeaders
    }),
    undefined,
    harness
  );

  expect(result.status).toBe(200);
});

test('Tesco favicon is served from FxTesco branding', async () => {
  const iconBody = new Uint8Array([137, 80, 78, 71]);
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  const assetsFetch = vi.fn(async (input: RequestInfo) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    expect(url.hostname).toBe('assets.fxtesco.com');
    expect(url.pathname).toBe('/logos/fxtesco-pride32.png');
    return new Response(iconBody, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': iconBody.byteLength.toString()
      }
    });
  });

  const result = await app.request(
    new Request('https://www.fxtesco.com/favicon.ico', {
      method: 'GET',
      headers: botHeaders
    }),
    undefined,
    {
      ...harness,
      ASSETS: { fetch: assetsFetch }
    }
  );
  const body = new Uint8Array(await result.arrayBuffer());

  expect(result.status).toBe(200);
  expect(result.headers.get('content-type')).toBe('image/png');
  expect(result.headers.get('content-length')).toBe(iconBody.byteLength.toString());
  expect(assetsFetch).toHaveBeenCalledTimes(1);
  expect(body.slice(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]));
  expect(body).toEqual(iconBody);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('Tesco image proxy fetches allowed product image URLs with browser image headers', async () => {
  const imageBody = new Uint8Array([0, 0, 0, 28]);
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    expect(url).toBe(mockTescoImageUrl);
    expect((init?.headers as Record<string, string>)['Sec-Fetch-Dest']).toBe('image');
    return new Response(imageBody, {
      status: 200,
      headers: {
        'Content-Type': 'image/avif',
        'Content-Length': imageBody.byteLength.toString()
      }
    });
  });

  const result = await app.request(
    new Request(`https://www.fxtesco.com/image?url=${encodeURIComponent(mockTescoImageUrl)}`, {
      method: 'GET',
      headers: botHeaders
    }),
    undefined,
    harness
  );
  const body = new Uint8Array(await result.arrayBuffer());

  expect(result.status).toBe(200);
  expect(result.headers.get('content-type')).toBe('image/avif');
  expect(result.headers.get('cache-control')).toBe('public, max-age=43200');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(body).toEqual(imageBody);
});
