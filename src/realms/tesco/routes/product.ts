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

export const productRequest = async (c: Context) => {
  const { locale, id } = c.req.param();
  const originalUrl = `https://www.tesco.com/groceries/${locale}/products/${id}`;

  console.log(`Fetching Tesco product: ${originalUrl}`);

  let useActivity = false;

  if (c.req.header('user-agent')?.includes('Discordbot')) {
    useActivity = true;
  }

  const [userAgent, secChUa] = generateUserAgent();

  try {
    const response = await fetch(originalUrl, {
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

    console.log(`Tesco fetch completed with status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Could not read error body');
      console.error(
        `Tesco fetch failed with status: ${response.status}. Body: ${errorText.substring(0, 500)}`
      );
      return c.redirect(originalUrl, 302);
    }

    // --- Use HTMLRewriter to process the response stream ---
    const collector = new TescoDataCollector();
    const rewriter = new HTMLRewriter()
      // Target meta tags using attribute selectors
      .on('meta[property="og:title"]', collector)
      .on('meta[property="og:description"]', collector)
      .on('meta[property="og:image"]', collector)
      // Target the JSON-LD script and its text content
      .on('script[type="application/ld+json"]', { text: text => collector.scriptText(text) })
      // Optional: Target the title tag's text content as a fallback
      .on('title', { text: text => collector.titleText(text) });

    // Process the stream to populate the collector. We need to consume it.
    // Using .arrayBuffer() or .text() consumes the stream and runs the handlers.
    await rewriter.transform(response).arrayBuffer();
    // --- End HTMLRewriter processing ---

    const product = collector.data as TescoProductData; // Cast after collection
    product.url = originalUrl; // Add the URL back

    // --- Validate collected data ---
    if (!product.name || !product.imageUrl) {
      console.error(
        `HTMLRewriter failed to collect essential product data (name/image). Name: ${product.name}, ImageURL: ${product.imageUrl}`
      );
      // Log the full collected state for debugging
      console.log('Final collector state:', JSON.stringify(collector.data));
      return c.redirect(originalUrl, 302);
    }

    // Sanitize potentially collected data (important!)
    product.name = sanitizeText(product.name);
    product.description = sanitizeText(product.description || 'View on Tesco.com'); // Provide default desc

    console.log('Parsed Tesco product with HTMLRewriter:', product);

    // --- Embed Generation ---
    const headers: string[] = [
      `<meta property="og:url" content="${product.url}"/>`,
      `<link rel="canonical" href="${product.url}"/>`,
      `<meta property="og:title" content="${product.name}"/>`,
      `<meta property="og:description" content="${product.description}"/>`, // Base description
      `<meta property="og:image" content="${product.imageUrl}"/>`,
      `<meta property="og:site_name" content="${product.brand ? `${product.brand} on Tesco` : 'Tesco'}"/>`,
      `<meta property="twitter:card" content="summary_large_image"/>`,
      `<meta property="twitter:title" content="${product.name}"/>`,
      `<meta property="twitter:description" content="${product.description}"/>`, // Base description
      `<meta property="twitter:image" content="${product.imageUrl}"/>`,
      `<meta property="twitter:site" content="@Tesco"/>`, // Generic handle
      `<meta name="theme-color" content="#00539f"/>` // Tesco Blue
    ];

    // If price exists, prepend it to the description meta tags for better visibility
    if (product.price) {
      headers.push(
        `<meta property="og:description" content="${product.price} - ${product.description}"/>`
      );
      headers.push(
        `<meta property="twitter:description" content="${product.price} - ${product.description}"/>`
      );
    }

    if (useActivity) {
      const icons = getBranding(c).activityIcons;
      const iconSizes = ['svg', '64', '48', '32', '24', '16'];
      for (const size of iconSizes) {
        let icon = icons?.[size];
        // Use default icon if size 32 is not available
        if (size === '32' && !icon) {
          icon = icons?.['default'];
        }
        const iconType = size === 'svg' ? 'image/svg+xml' : 'image/png';
        if (icon) {
          headers.push(
            `<link href='${icon}' rel='icon' sizes='${size}x${size}' type='${iconType}'>`
          );
        }
      }
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
      const data: { i: string; l?: string; h?: string; t?: number; m?: number; n?: number } = {
        i: id
      };
      /* Convert necessary flags into snowcode data */
      // if (language !== status.lang) {
      //   data.l = language;
      // }
      // if (status.provider === DataProvider.Bsky) {
      //   data.h = status.author.id;
      // }
      data.h = id;
      // if (flags.textOnly) {
      //   data.t = 1;
      // }
      // if (flags.nativeMultiImage) {
      //   data.m = 1;
      // }
      // if (mediaNumber) {
      //   data.n = mediaNumber;
      // }
      // const snowflake = encodeSnowcode(data);
      // console.log('snowflake', snowflake);
      /* Convince Discord that you are actually a Mastodon link lol */
      let base = Constants.TESCO_DOMAIN_LIST[0];

      try {
        base = new URL(c.req.url).hostname;
      } catch (e) {
        console.log('couldnt parse hostname for some reason', e);
      }

      // groceries/${locale}/products/${id}
      // headers.push(
      //   `<link href='{base}/users/{author}/statuses/{status}' rel='alternate' type='application/activity+json'>`.format(
      //     {
      //       base: `https://${base}`,
      //       author: encodeURIComponent('tesco'),
      //       status: snowflake
      //     }
      //   )
      // );
      headers.push(
        `<link href='{base}/groceries/{locale}/products/{id}' rel='alternate' type='application/activity+json'>`.format(
          {
            base: `https://${base}`,
            locale: encodeURIComponent(locale),
            id: encodeURIComponent(id)
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
