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
  expect(html).toContain(
    "<link href='https://www.fxtesco.com/shop/en-GB/products/323311991' rel='alternate' type='application/activity+json'>"
  );
  expect(html).not.toContain('http-equiv="refresh"');
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
