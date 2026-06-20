import { Hono } from 'hono';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { faviconRoute } from '../../helpers/favicon';
import { productActivityRequest, productImageRequest, productRequest } from './routes/product';

export const tesco = new Hono();

tesco.use(trimTrailingSlash());

// Match Tesco product URLs.
// Current example: /shop/en-GB/products/259742068
tesco.get('/shop/:locale{[a-zA-Z-]+}/products/:id{[0-9]+}', productRequest);

// Legacy Tesco product URLs.
// Example: /groceries/en-GB/products/259742068
// Allows for different locales and captures the product ID
tesco.get('/groceries/:locale{[a-zA-Z-]+}/products/:id{[0-9]+}', productRequest);
tesco.get('/users/:author{tesco}/statuses/:id{[0-9]+}', productActivityRequest);
tesco.get('/image', productImageRequest);
tesco.get('/favicon.ico', faviconRoute);

// Fallback: Redirect any other Tesco paths to the main Tesco site
tesco.all('*', c => c.redirect('https://www.tesco.com', 302));
