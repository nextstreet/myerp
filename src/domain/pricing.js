export const SITE_RULES = Object.freeze({
  MLM: { country: 'Mexico', currency: 'MXN', roundingStep: 1 },
  MCO: { country: 'Colombia', currency: 'COP', roundingStep: 100 },
  MLC: { country: 'Chile', currency: 'CLP', roundingStep: 100 }
});

function positive(value, name, allowZero = true) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) {
    throw new TypeError(`${name} must be ${allowZero ? 'non-negative' : 'positive'}`);
  }
  return number;
}

function rate(value, name) {
  const number = positive(value, name);
  if (number >= 1) throw new TypeError(`${name} must be less than 1`);
  return number;
}

function roundUp(value, step) {
  return Math.ceil(value / step) * step;
}

function money(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates a transparent site quote. The normal price contains a promotion
 * buffer so the test promotion still satisfies the requested target.
 */
export function calculateSiteQuote(input) {
  const rule = SITE_RULES[input.site];
  if (!rule) throw new TypeError(`Unsupported site: ${input.site}`);

  const purchasePriceCny = positive(input.purchasePriceCny, 'purchasePriceCny');
  const cnyPerUsd = positive(input.cnyPerUsd, 'cnyPerUsd', false);
  const siteCurrencyPerUsd = positive(input.siteCurrencyPerUsd, 'siteCurrencyPerUsd', false);
  const internationalFreightUsd = positive(input.internationalFreightUsd, 'internationalFreightUsd');
  const localFulfillmentFee = positive(input.localFulfillmentFee, 'localFulfillmentFee');
  const otherFixedCost = positive(input.otherFixedCost ?? 0, 'otherFixedCost');
  const commissionRate = rate(input.commissionRate, 'commissionRate');
  const taxRate = rate(input.taxRate, 'taxRate');
  const targetProfitUsd = positive(input.targetProfitUsd, 'targetProfitUsd');
  const targetMarginRate = rate(input.targetMarginRate, 'targetMarginRate');
  const promotionDiscountRate = rate(input.promotionDiscountRate ?? 0.05, 'promotionDiscountRate');

  const variableCostRate = commissionRate + taxRate;
  if (variableCostRate >= 1) throw new TypeError('commissionRate + taxRate must be less than 1');
  if (variableCostRate + targetMarginRate >= 1) {
    throw new TypeError('variable costs plus target margin must be less than 1');
  }

  const purchaseCost = (purchasePriceCny / cnyPerUsd) * siteCurrencyPerUsd;
  const internationalFreight = internationalFreightUsd * siteCurrencyPerUsd;
  const fixedCost = purchaseCost + internationalFreight + localFulfillmentFee + otherFixedCost;
  const targetProfit = targetProfitUsd * siteCurrencyPerUsd;

  const priceForProfit = (fixedCost + targetProfit) / (1 - variableCostRate);
  const priceForMargin = fixedCost / (1 - variableCostRate - targetMarginRate);
  const requiredPromotionalPrice = Math.max(priceForProfit, priceForMargin);
  const promotionalPrice = roundUp(requiredPromotionalPrice, rule.roundingStep);
  const normalPrice = roundUp(promotionalPrice / (1 - promotionDiscountRate), rule.roundingStep);

  const evaluate = (price) => {
    const variableCosts = price * variableCostRate;
    const netProfit = price - fixedCost - variableCosts;
    return {
      price: money(price),
      variableCosts: money(variableCosts),
      netProfit: money(netProfit),
      netProfitUsd: money(netProfit / siteCurrencyPerUsd),
      netMarginRate: Math.round((netProfit / price) * 10000) / 10000
    };
  };

  return {
    site: input.site,
    country: rule.country,
    currency: rule.currency,
    normal: evaluate(normalPrice),
    promotion: evaluate(promotionalPrice),
    basis: {
      purchasePriceCny,
      packedWeightG: positive(input.packedWeightG, 'packedWeightG', false),
      cnyPerUsd,
      siteCurrencyPerUsd,
      internationalFreightUsd,
      localFulfillmentFee,
      otherFixedCost,
      commissionRate,
      taxRate,
      targetProfitUsd,
      targetMarginRate,
      promotionDiscountRate,
      fixedCostLocal: money(fixedCost),
      priceFloorByProfit: money(priceForProfit),
      priceFloorByMargin: money(priceForMargin)
    }
  };
}

export function calculateThreeSiteQuotes(input) {
  const siteInputs = input.sites ?? {};
  return Object.keys(SITE_RULES).map((site) => calculateSiteQuote({
    ...input.common,
    ...siteInputs[site],
    site
  }));
}
