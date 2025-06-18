import { Hono } from 'hono';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { productRequest } from './routes/product';

export const tesco = new Hono();

tesco.use(trimTrailingSlash());

// Match typical Tesco product URLs
// Example: /groceries/en-GB/products/259742068
// Allows for different locales and captures the product ID
tesco.get('/groceries/:locale{[a-zA-Z-]+}/products/:id{[0-9]+}', productRequest);

// Fallback: Redirect any other Tesco paths to the main Tesco site
tesco.all('*', c => c.redirect('https://www.tesco.com', 302));
