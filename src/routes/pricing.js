import { calculateSiteQuote, calculateThreeSiteQuotes } from '../domain/pricing.js';

export async function pricingRoutes(app) {
  app.post('/quote', async (request) => calculateSiteQuote(request.body ?? {}));
  app.post('/quote-all', async (request) => ({ quotes: calculateThreeSiteQuotes(request.body ?? {}) }));
}
