import { Context } from 'hono';
import { Strings } from '../../../strings';
import { Constants } from '../../../constants';
// import { encodeSnowcode } from '../../../helpers/snowcode';
import { sanitizeText } from '../../../helpers/utils';
import { generateUserAgent } from '../../../helpers/useragent';
import { getBranding } from '../../../helpers/branding';

// Interface for the data we want to collect
interface TescoProductData {
  url: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  price?: string; // Keep as string for currency symbol
  brand?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// Handler class to collect data using HTMLRewriter
class TescoDataCollector {
  // Use Partial<> because fields are populated incrementally
  data: Partial<TescoProductData> = {};
  scriptContent = ''; // Accumulator for JSON-LD script content

  // Handles <meta property="..." content="..."> tags
  element(element: Element) {
    const property = element.getAttribute('property');
    const content = element.getAttribute('content');

    // Only proceed if content exists
    if (!content) {
      return;
    }

    // Prioritize OpenGraph tags, potentially add fallbacks for twitter: tags if needed
    switch (property) {
      case 'og:title':
        this.data.name = this.data.name || content; // Use first-found name
        break;
      case 'og:description':
        this.data.description = this.data.description || content;
        break;
      case 'og:image':
        this.data.imageUrl = this.data.imageUrl || content;
        break;
      // Example fallback for twitter:description
      // case 'twitter:description':
      //     this.data.description = this.data.description || content;
      //     break;
    }
  }

  // Handles text content inside <script type="application/ld+json">
  scriptText(text: Text) {
    this.scriptContent += text.text;

    // lastInTextNode is true when the full text content of the script tag has been received
    if (text.lastInTextNode) {
      try {
        const jsonData: unknown = JSON.parse(this.scriptContent);
        let productSchema: Record<string, unknown> | null = null;

        // Find the Product schema, whether directly or in @graph
        if (isRecord(jsonData) && jsonData['@type'] === 'Product') {
          productSchema = jsonData;
        } else if (isRecord(jsonData) && Array.isArray(jsonData['@graph'])) {
          productSchema =
            jsonData['@graph'].find(
              (item): item is Record<string, unknown> =>
                isRecord(item) && item['@type'] === 'Product'
            ) ?? null;
        }

        if (productSchema) {
          // Update collected data, potentially overwriting meta tag values if JSON-LD is more specific
          this.data.name =
            typeof productSchema.name === 'string' ? productSchema.name : this.data.name;
          this.data.description =
            typeof productSchema.description === 'string'
              ? productSchema.description
              : this.data.description;
          // Handle image potentially being an array
          const image = Array.isArray(productSchema.image)
            ? productSchema.image.find((item): item is string => typeof item === 'string')
            : productSchema.image;
          this.data.imageUrl = typeof image === 'string' ? image : this.data.imageUrl;
          this.data.brand =
            isRecord(productSchema.brand) && typeof productSchema.brand.name === 'string'
              ? productSchema.brand.name
              : this.data.brand;

          // Extract price info
          const offer = Array.isArray(productSchema.offers)
            ? productSchema.offers[0]
            : productSchema.offers;
          if (isRecord(offer) && offer.price && typeof offer.priceCurrency === 'string') {
            let currencySymbol = '';
            switch (offer.priceCurrency) {
              case 'GBP':
                currencySymbol = '£';
                break;
              // Add other currencies if needed
              default:
                currencySymbol = offer.priceCurrency + ' ';
            }
            // Ensure price is a number before formatting
            const priceValue = Number(offer.price);
            if (!isNaN(priceValue)) {
              this.data.price = `${currencySymbol}${priceValue.toFixed(2)}`;
            }
          }
          console.log(
            `Successfully parsed JSON-LD product data. Name: ${this.data.name}, Brand: ${this.data.brand}, Price: ${this.data.price}`
          );
        } else {
          console.warn('JSON-LD script found, but no "@type": "Product" schema detected within.');
        }
      } catch (e) {
        // Log JSON parsing errors, but don't halt execution
        console.warn(
          `Failed to parse JSON-LD content: ${e}`,
          `Content (start): ${this.scriptContent.substring(0, 100)}`
        );
      } finally {
        // Reset accumulator for the next potential script tag
        this.scriptContent = '';
      }
    }
  }

  // Optional: Handler for <title> text if needed as a final fallback for name
  titleText(text: Text) {
    // Only accumulate if name hasn't been found yet from meta/JSON-LD
    if (!this.data.name) {
      this.data.name = (this.data.name || '') + text.text;
      if (text.lastInTextNode && this.data.name) {
        // Clean up the title tag content once fully received
        this.data.name = this.data.name.replace(' - Tesco Groceries', '').trim();
        console.log(`Used <title> tag as fallback for product name: ${this.data.name}`);
      }
    }
  }
}

const tescoProductUrl = (locale: string, id: string) =>
  `https://www.tesco.com/shop/${locale}/products/${id}`;

const currentProductUrl = (c: Context): string => {
  const url = new URL(c.req.url);
  url.search = '';
  url.hash = '';
  return url.toString();
};

const tescoProductCacheRequest = (locale: string, id: string) =>
  new Request(
    `https://fxtesco.internal/cache/tesco/${encodeURIComponent(locale)}/products/${encodeURIComponent(id)}`
  );

const getExecutionCtx = (c: Context): ExecutionContext | null => {
  try {
    return c.executionCtx ?? null;
  } catch (_e) {
    return null;
  }
};

const isTescoImageUrl = (url: URL): boolean =>
  url.hostname === 'digitalcontent.api.tesco.com' && url.pathname.startsWith('/v2/media/');

const proxyTescoImageUrl = (c: Context, imageUrl: string | undefined): string => {
  if (!imageUrl) {
    return '';
  }

  try {
    const url = new URL(imageUrl);
    if (!isTescoImageUrl(url)) {
      return imageUrl;
    }
    const base = new URL(c.req.url);
    return `${base.origin}/image?url=${encodeURIComponent(url.toString())}`;
  } catch (_e) {
    return imageUrl;
  }
};

const getActivityIcon = (c: Context): string | undefined => {
  const icons = getBranding(c).activityIcons;
  if (!icons) {
    return undefined;
  }
  return Array.isArray(icons) ? icons[0]?.default : icons.default;
};

const appendBrandingIconLinks = (c: Context, headers: string[]) => {
  const icons = getBranding(c).activityIcons;
  if (!icons) {
    return;
  }

  const iconSet = Array.isArray(icons) ? icons[0] : icons;
  const defaultIcon = iconSet.default;
  const iconSizes = ['32', '64', '48', '24', '16'] as const;
  const emitted = new Set<string>();

  if (defaultIcon) {
    headers.push(`<link rel="apple-touch-icon" href="${defaultIcon}"/>`);
  }

  for (const size of iconSizes) {
    const icon = size === '32' ? (iconSet['32'] ?? defaultIcon) : iconSet[size];
    if (!icon || emitted.has(icon)) {
      continue;
    }

    emitted.add(icon);
    headers.push(`<link rel="icon" href="${icon}" sizes="${size}x${size}" type="image/png"/>`);
  }

  if (iconSet.svg && !emitted.has(iconSet.svg)) {
    headers.push(`<link rel="icon" href="${iconSet.svg}" sizes="any" type="image/svg+xml"/>`);
  }
};

const readCachedTescoProduct = async (
  locale: string,
  id: string
): Promise<TescoProductData | null> => {
  if (typeof caches === 'undefined') {
    return null;
  }

  try {
    const response = await caches.default.match(tescoProductCacheRequest(locale, id));
    if (!response?.ok) {
      return null;
    }

    const data: unknown = await response.json();
    if (
      !isRecord(data) ||
      typeof data.url !== 'string' ||
      typeof data.name !== 'string' ||
      typeof data.imageUrl !== 'string'
    ) {
      return null;
    }

    return {
      url: data.url,
      name: data.name,
      imageUrl: data.imageUrl,
      description: typeof data.description === 'string' ? data.description : undefined,
      price: typeof data.price === 'string' ? data.price : undefined,
      brand: typeof data.brand === 'string' ? data.brand : undefined
    };
  } catch (e) {
    console.error('Failed to read cached Tesco product:', e);
    return null;
  }
};

const cacheTescoProduct = (
  executionCtx: ExecutionContext | null,
  locale: string,
  id: string,
  product: TescoProductData
) => {
  if (typeof caches === 'undefined' || !executionCtx) {
    return;
  }

  const response = new Response(JSON.stringify(product), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=43200'
    }
  });

  executionCtx.waitUntil(caches.default.put(tescoProductCacheRequest(locale, id), response));
};

const fetchTescoProduct = async (
  c: Context,
  locale: string,
  id: string
): Promise<TescoProductData | null> => {
  const originalUrl = tescoProductUrl(locale, id);
  const executionCtx = getExecutionCtx(c);
  const cachedProduct = executionCtx ? await readCachedTescoProduct(locale, id) : null;

  console.log(`Fetching Tesco product: ${originalUrl}`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const [userAgent, secChUa] = generateUserAgent();

    let response: Response;
    try {
      response = await fetch(originalUrl, {
        headers: {
          'User-Agent': userAgent,
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          ...(secChUa && {
            'sec-ch-ua': secChUa,
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"'
          })
        },
        redirect: 'follow'
      });
    } catch (e) {
      console.error(`Tesco fetch attempt ${attempt} threw:`, e);
      continue;
    }

    console.log(`Tesco fetch attempt ${attempt} completed with status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Could not read error body');
      console.error(
        `Tesco fetch attempt ${attempt} failed with status: ${response.status}. Body: ${errorText.substring(0, 500)}`
      );
      continue;
    }

    const collector = new TescoDataCollector();
    const rewriter = new HTMLRewriter()
      .on('meta[property="og:title"]', collector)
      .on('meta[property="og:description"]', collector)
      .on('meta[property="og:image"]', collector)
      .on('script[type="application/ld+json"]', { text: text => collector.scriptText(text) })
      .on('title', { text: text => collector.titleText(text) });

    await rewriter.transform(response).arrayBuffer();

    const product = collector.data as TescoProductData;
    product.url = originalUrl;

    if (!product.name || !product.imageUrl) {
      console.error(
        `HTMLRewriter failed to collect essential product data (name/image). Name: ${product.name}, ImageURL: ${product.imageUrl}`
      );
      console.log('Final collector state:', JSON.stringify(collector.data));
      continue;
    }

    product.name = sanitizeText(product.name);
    product.description = sanitizeText(product.description || 'View on Tesco.com');

    console.log('Parsed Tesco product with HTMLRewriter:', product);
    cacheTescoProduct(executionCtx, locale, id, product);

    return product;
  }

  if (cachedProduct) {
    console.warn(`Using cached Tesco product after fresh fetch failures: ${originalUrl}`);
    return cachedProduct;
  }

  return null;
};

const buildProductActivityStatus = (
  c: Context,
  product: TescoProductData,
  locale: string,
  id: string
): ActivityStatus => {
  const avatar = getActivityIcon(c);
  const imageUrl = proxyTescoImageUrl(c, product.imageUrl);
  const accountUrl = 'https://www.tesco.com';
  const description = product.price
    ? `<p><b>${product.price}</b><br>${product.description}</p>`
    : `<p>${product.description}</p>`;

  return {
    id,
    url: product.url,
    uri: product.url,
    created_at: new Date(0).toISOString(),
    edited_at: null,
    reblog: null,
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    language: locale.split('-')[0] || 'en',
    content: description,
    spoiler_text: '',
    visibility: 'public',
    application: {
      name: 'Tesco',
      website: accountUrl
    },
    media_attachments: [
      {
        id,
        type: 'image',
        url: imageUrl,
        preview_url: null,
        remote_url: null,
        preview_remote_url: null,
        text_url: null,
        description: product.name ?? null,
        meta: {}
      }
    ],
    account: {
      id: 'tesco',
      display_name: product.brand ? `${product.brand} on Tesco` : 'Tesco',
      username: 'tesco',
      acct: 'tesco',
      url: accountUrl,
      uri: accountUrl,
      created_at: new Date(0).toISOString(),
      locked: false,
      bot: false,
      discoverable: true,
      indexable: false,
      group: false,
      avatar,
      avatar_static: avatar,
      header: undefined,
      header_static: undefined,
      followers_count: undefined,
      following_count: undefined,
      statuses_count: undefined,
      hide_collections: false,
      noindex: false,
      emojis: [],
      roles: [],
      fields: []
    },
    mentions: [],
    tags: [],
    emojis: [],
    card: null,
    poll: null
  };
};

export const productRequest = async (c: Context) => {
  const { locale, id } = c.req.param();
  const originalUrl = tescoProductUrl(locale, id);
  const embedUrl = currentProductUrl(c);

  let useActivity = false;

  if (c.req.header('user-agent')?.includes('Discordbot')) {
    useActivity = true;
  }

  try {
    const product = await fetchTescoProduct(c, locale, id);
    if (!product) {
      return c.redirect(originalUrl, 302);
    }
    const imageUrl = proxyTescoImageUrl(c, product.imageUrl);

    // --- Embed Generation ---
    const headers: string[] = [
      `<meta property="og:url" content="${embedUrl}"/>`,
      `<link rel="canonical" href="${embedUrl}"/>`,
      `<meta property="og:title" content="${product.name}"/>`,
      `<meta property="og:description" content="${product.description}"/>`, // Base description
      `<meta property="og:image" content="${imageUrl}"/>`,
      `<meta property="og:site_name" content="${product.brand ? `${product.brand} on Tesco` : 'Tesco'}"/>`,
      `<meta property="twitter:card" content="summary_large_image"/>`,
      `<meta property="twitter:title" content="${product.name}"/>`,
      `<meta property="twitter:description" content="${product.description}"/>`, // Base description
      `<meta property="twitter:image" content="${imageUrl}"/>`,
      `<meta property="twitter:site" content="@Tesco"/>`, // Generic handle
      `<meta name="theme-color" content="#00539f"/>` // Tesco Blue
    ];

    appendBrandingIconLinks(c, headers);

    // If price exists, prepend it to the description meta tags for better visibility
    if (product.price) {
      headers.push(
        `<meta property="og:description" content="${product.price} - ${product.description}"/>`
      );
      headers.push(
        `<meta property="twitter:description" content="${product.price} - ${product.description}"/>`
      );
    }

    // Bot check for redirect header
    const reqUserAgent = c.req.header('User-Agent') ?? '';
    const isBotUA = reqUserAgent.match(Constants.BOT_UA_REGEX) !== null;

    if (!isBotUA) {
      headers.push(`<meta http-equiv="refresh" content="0;url=${product.url}"/>`);
    } else {
      console.log('Bot User Agent detected, skipping meta refresh redirect.');
    }

    if (useActivity) {
      let base = Constants.TESCO_DOMAIN_LIST[0];

      try {
        base = new URL(c.req.url).hostname;
      } catch (e) {
        console.log('couldnt parse hostname for some reason', e);
      }

      /* Convince Discord that you are actually a Mastodon link lol */
      headers.push(
        `<link href='{base}/users/{author}/statuses/{status}?locale={locale}' rel='alternate' type='application/activity+json'>`.format(
          {
            base: `https://${base}`,
            author: encodeURIComponent('tesco'),
            status: encodeURIComponent(id),
            locale: encodeURIComponent(locale)
          }
        )
      );
    }

    const lang = locale?.split('-')[0] || 'en';

    return c.html(
      Strings.BASE_HTML.format({
        lang: `lang="${lang}"`, // Use language from locale
        headers: headers.join(''),
        body: ''
      }) //.replace(/>(\s+)</gm, '><')
    );
  } catch (e) {
    console.error(`Error processing Tesco request for ${originalUrl}:`, e);
    // Ensure redirect happens even if errors occur after fetch
    return c.redirect(originalUrl, 302);
  }
};

export const productActivityRequest = async (c: Context) => {
  const { id } = c.req.param();
  const locale = c.req.query('locale') || 'en-GB';
  const product = await fetchTescoProduct(c, locale, id);

  if (!product) {
    return c.json({ error: 'Could not fetch Tesco product' }, 502);
  }

  return c.json(buildProductActivityStatus(c, product, locale, id));
};

export const productImageRequest = async (c: Context) => {
  const imageUrl = c.req.query('url');

  if (!imageUrl) {
    return c.text('Missing url', 400);
  }

  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch (_e) {
    return c.text('Invalid url', 400);
  }

  if (!isTescoImageUrl(url)) {
    return c.text('Invalid image host', 400);
  }
  url.searchParams.set('fm', 'jpg');

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'image/jpeg,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': 'https://www.tesco.com/',
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'same-site'
    },
    redirect: 'follow'
  });

  const headers = new Headers();
  const contentType = response.headers.get('Content-Type');
  const contentLength = response.headers.get('Content-Length');
  if (contentType) {
    headers.set('Content-Type', contentType);
  }
  if (contentLength) {
    headers.set('Content-Length', contentLength);
  }
  headers.set('Cache-Control', 'public, max-age=43200');

  return new Response(response.body, {
    status: response.status,
    headers
  });
};
