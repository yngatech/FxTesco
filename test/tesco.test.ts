import { afterEach, expect, test, vi } from 'vitest';
import { app } from '../src/worker';
import { botHeaders } from './helpers/data';
import harness from './helpers/harness';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    '<meta property="og:url" content="https://www.fxtesco.com/shop/en-GB/products/323311991"/>'
  );
  expect(html).toContain(
    '<link rel="canonical" href="https://www.fxtesco.com/shop/en-GB/products/323311991"/>'
  );
  expect(html).toContain(`<meta property="og:image" content="${proxiedMockTescoImageUrl}"/>`);
  expect(html).toContain(
    '<link rel="icon" href="https://assets.fxtesco.com/logos/fxtesco-pride32.png" sizes="32x32" type="image/png"/>'
  );
  expect(html).toContain(
    '<link rel="icon" href="https://assets.fxtesco.com/logos/fxtesco-pride64.png" sizes="64x64" type="image/png"/>'
  );
  expect(html).toContain(
    '<link rel="apple-touch-icon" href="https://assets.fxtesco.com/logos/fxtesco-pride32.png"/>'
  );
  expect(html).toContain('<link rel="alternate" href="https://fxtesco.com/owoembed?');
  expect(html).toContain('type="application/json+oembed"');
  expect(html).toContain(
    'text=Tesco%20Finest%20Sea%20Salt%20%26%20Chardonnay%20Vinegar%20Handcooked%20Crisps%20150g'
  );
  expect(html).toContain('status=323311991');
  expect(html).toContain('locale=en-GB');
  expect(html).toContain('provider=Tesco%20Finest%20on%20Tesco');
  expect(html).not.toContain('application/activity+json');
  expect(html).not.toContain('svgxsvg');
  expect(html).not.toContain('image/svg+xml');
  expect(html).not.toContain('http-equiv="refresh"');
});

test('Tesco oEmbed returns FxEmbed-style provider metadata', async () => {
  const result = await app.request(
    new Request(
      `https://www.fxtesco.com/owoembed?text=${encodeURIComponent('Tesco Finest Crisps')}&status=323311991&locale=en-GB&provider=${encodeURIComponent('Tesco Finest on Tesco')}`,
      {
        method: 'GET',
        headers: botHeaders
      }
    ),
    undefined,
    harness
  );
  const body = (await result.json()) as OEmbed;

  expect(result.status).toBe(200);
  expect(result.headers.get('content-type')).toBe('application/json');
  expect(body).toEqual({
    author_name: 'Tesco Finest Crisps',
    author_url: 'https://www.tesco.com/shop/en-GB/products/323311991',
    provider_name: 'Tesco Finest on Tesco',
    provider_url: 'https://www.fxtesco.com/shop/en-GB/products/323311991',
    title: 'Embed',
    type: 'rich',
    version: '1.0'
  });
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
  expect(body.url).toBe('https://www.fxtesco.com/shop/en-GB/products/323311991');
  expect(body.uri).toBe('https://www.fxtesco.com/shop/en-GB/products/323311991');
  expect(body.application.website).toBe('https://www.fxtesco.com');
  expect(body.account.url).toBe('https://www.fxtesco.com/shop/en-GB/products/323311991');
  expect(body.account.uri).toBe('https://www.fxtesco.com/shop/en-GB/products/323311991');
  expect(body.account.avatar).toBe('https://assets.fxtesco.com/logos/fxtesco-pride64.png');
  expect(body.content).toContain('£1.50');
  expect(body.media_attachments[0]?.url).toBe(proxiedMockTescoImageUrl);
  expect(JSON.stringify(body)).not.toContain('https://www.tesco.com');
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
  const html = await result.text();

  expect(result.status).toBe(200);
  expect(html).toContain(
    '<meta property="og:url" content="https://www.fxtesco.com/groceries/en-GB/products/323311991"/>'
  );
  expect(html).toContain('<link rel="alternate" href="https://fxtesco.com/owoembed?');
  expect(html).toContain('status=323311991');
  expect(html).toContain('locale=en-GB');
});

test('Tesco human product pages advertise FxTesco icons before redirecting', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(mockTescoProductHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    })
  );

  const result = await app.request(
    new Request('https://www.fxtesco.com/shop/en-GB/products/323311991', {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }),
    undefined,
    harness
  );
  const html = await result.text();

  expect(result.status).toBe(200);
  expect(html).toContain(
    '<meta property="og:url" content="https://www.fxtesco.com/shop/en-GB/products/323311991"/>'
  );
  expect(html).toContain(
    '<link rel="icon" href="https://assets.fxtesco.com/logos/fxtesco-pride32.png" sizes="32x32" type="image/png"/>'
  );
  expect(html).toContain(
    '<link rel="apple-touch-icon" href="https://assets.fxtesco.com/logos/fxtesco-pride32.png"/>'
  );
  expect(html).toContain(
    '<meta http-equiv="refresh" content="0;url=https://www.tesco.com/shop/en-GB/products/323311991"/>'
  );
});

test('Tesco product fetch retries transient upstream failures', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('blocked', { status: 403 }))
    .mockResolvedValueOnce(
      new Response(mockTescoProductHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
      })
    );

  const result = await app.request(
    new Request('https://www.fxtesco.com/shop/en-GB/products/323311991', {
      method: 'GET',
      headers: botHeaders
    }),
    undefined,
    harness
  );

  expect(result.status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('Tesco product fetch falls back to cached product data after upstream failures', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('blocked', { status: 403 }));
  const cacheMatch = vi.fn(async (request: Request) => {
    expect(request.url).toBe('https://fxtesco.internal/cache/tesco/en-GB/products/323311991');
    return new Response(
      JSON.stringify({
        url: 'https://www.tesco.com/shop/en-GB/products/323311991',
        name: 'Cached Tesco Product',
        description: 'Cached product description.',
        imageUrl: mockTescoImageUrl,
        price: '£1.50',
        brand: 'TESCO finest'
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  });
  const cachePut = vi.fn();
  vi.stubGlobal('caches', {
    default: {
      match: cacheMatch,
      put: cachePut
    }
  });

  const result = await app.request(
    new Request('https://www.fxtesco.com/shop/en-GB/products/323311991', {
      method: 'GET',
      headers: botHeaders
    }),
    undefined,
    harness,
    {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn()
    } as unknown as ExecutionContext
  );
  const html = await result.text();

  expect(result.status).toBe(200);
  expect(result.headers.get('location')).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(cacheMatch).toHaveBeenCalledTimes(1);
  expect(cachePut).not.toHaveBeenCalled();
  expect(html).toContain('<meta property="og:title" content="Cached Tesco Product"/>');
  expect(html).toContain(`<meta property="og:image" content="${proxiedMockTescoImageUrl}"/>`);
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
    expect(url).toBe(`${mockTescoImageUrl}?fm=jpg`);
    expect((init?.headers as Record<string, string>)['Accept']).toBe(
      'image/jpeg,image/*,*/*;q=0.8'
    );
    expect((init?.headers as Record<string, string>)['Sec-Fetch-Dest']).toBe('image');
    return new Response(imageBody, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
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
  expect(result.headers.get('content-type')).toBe('image/jpeg');
  expect(result.headers.get('cache-control')).toBe('public, max-age=43200');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(body).toEqual(imageBody);
});
