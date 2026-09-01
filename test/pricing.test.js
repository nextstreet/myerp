import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSiteQuote, calculateThreeSiteQuotes } from '../src/domain/pricing.js';

const common = {
  purchasePriceCny: 10,
  packedWeightG: 500,
  cnyPerUsd: 7.2,
  internationalFreightUsd: 4.5,
  targetProfitUsd: 5,
  targetMarginRate: 0.25,
  promotionDiscountRate: 0.05
};

test('promotion price meets both profit and margin targets', () => {
  const quote = calculateSiteQuote({
    ...common,
    site: 'MLM',
    siteCurrencyPerUsd: 18,
    localFulfillmentFee: 45,
    otherFixedCost: 5,
    commissionRate: 0.18,
    taxRate: 0.08
  });
  assert.equal(quote.currency, 'MXN');
  assert.ok(quote.normal.price > quote.promotion.price);
  assert.ok(quote.promotion.netProfitUsd >= 5);
  assert.ok(quote.promotion.netMarginRate >= 0.25);
});

test('three-site quote preserves independent site rules', () => {
  const result = calculateThreeSiteQuotes({
    common,
    sites: {
      MLM: { siteCurrencyPerUsd: 18, localFulfillmentFee: 45, commissionRate: 0.18, taxRate: 0.08 },
      MCO: { siteCurrencyPerUsd: 4000, localFulfillmentFee: 12000, commissionRate: 0.17, taxRate: 0.08 },
      MLC: { siteCurrencyPerUsd: 950, localFulfillmentFee: 3000, commissionRate: 0.17, taxRate: 0.08 }
    }
  });
  assert.deepEqual(result.map((item) => item.site), ['MLM', 'MCO', 'MLC']);
  assert.equal(result[1].normal.price % 100, 0);
  assert.equal(result[2].promotion.price % 100, 0);
});

test('invalid rates are rejected', () => {
  assert.throws(() => calculateSiteQuote({
    ...common,
    site: 'MLM', siteCurrencyPerUsd: 18, localFulfillmentFee: 0,
    commissionRate: 0.8, taxRate: 0.3
  }), /less than 1/);
});
