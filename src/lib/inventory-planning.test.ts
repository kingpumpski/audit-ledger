import { describe, expect, it } from 'vitest';
import {
  calculateDemandStatistics,
  calculateReplenishmentPlan,
  classifyInventoryPortfolio,
} from './inventory-planning';

describe('calculateDemandStatistics', () => {
  it('excludes stockout days instead of treating constrained sales as zero demand', () => {
    const result = calculateDemandStatistics([
      { unitsSold: 0, wasStockout: false },
      { unitsSold: 2, wasStockout: false },
      { unitsSold: 4, wasStockout: false },
      { unitsSold: 50, wasStockout: true },
    ]);

    expect(result.averageDailyDemand).toBe(2);
    expect(result.dailyDemandStandardDeviation).toBeCloseTo(Math.sqrt(8 / 3), 6);
    expect(result.observedDays).toBe(3);
    expect(result.excludedStockoutDays).toBe(1);
    expect(result.confidence).toBe('low');
  });

  it('marks a sufficiently long, low-stockout demand history as high confidence', () => {
    const result = calculateDemandStatistics(
      Array.from({ length: 60 }, (_, index) => ({
        unitsSold: index % 2 ? 3 : 1,
        wasStockout: false,
      })),
    );

    expect(result.observedDays).toBe(60);
    expect(result.confidence).toBe('high');
  });

  it('rejects invalid daily demand values', () => {
    expect(() => calculateDemandStatistics([{ unitsSold: -1, wasStockout: false }]))
      .toThrow('finite, non-negative');
  });
});

describe('calculateReplenishmentPlan', () => {
  it('calculates safety stock, reorder point, inventory position and pack-rounded order quantity', () => {
    const result = calculateReplenishmentPlan({
      averageDailyDemand: 4,
      dailyDemandStandardDeviation: 2,
      leadTimeDays: 5,
      onHand: 20,
      reserved: 2,
      quarantined: 1,
      onOrder: 5,
      backorders: 3,
      serviceLevelZ: 1.645,
      targetDaysOfCover: 30,
      minimumOrderQuantity: 12,
      orderMultiple: 6,
      demandConfidence: 'medium',
    });

    expect(result.safetyStock).toBeCloseTo(1.645 * 2 * Math.sqrt(5), 5);
    expect(result.reorderPoint).toBeCloseTo(20 + (1.645 * 2 * Math.sqrt(5)), 5);
    expect(result.inventoryPosition).toBe(19);
    expect(result.shouldReorder).toBe(true);
    expect(result.suggestedOrderQuantity).toBe(114);
    expect(result.confidence).toBe('medium');
    expect(result.explanation.some(line => line.includes('stockout days'))).toBe(true);
  });

  it('does not recommend an order when inventory position is above the reorder point', () => {
    const result = calculateReplenishmentPlan({
      averageDailyDemand: 1,
      dailyDemandStandardDeviation: 0,
      leadTimeDays: 2,
      onHand: 100,
      targetDaysOfCover: 14,
    });

    expect(result.shouldReorder).toBe(false);
    expect(result.suggestedOrderQuantity).toBe(0);
  });

  it('supports manager-controlled safety stock and reorder-point overrides', () => {
    const result = calculateReplenishmentPlan({
      averageDailyDemand: 2,
      dailyDemandStandardDeviation: 3,
      leadTimeDays: 4,
      onHand: 4,
      safetyStockOverride: 8,
      reorderPointOverride: 20,
      targetDaysOfCover: 5,
    });

    expect(result.safetyStock).toBe(8);
    expect(result.reorderPoint).toBe(20);
    expect(result.shouldReorder).toBe(true);
  });

  it('rejects negative or invalid inventory inputs', () => {
    expect(() => calculateReplenishmentPlan({
      averageDailyDemand: 1,
      dailyDemandStandardDeviation: 1,
      leadTimeDays: 3,
      onHand: -1,
    })).toThrow('On-hand quantity must be a finite, non-negative number.');

    expect(() => calculateReplenishmentPlan({
      averageDailyDemand: 1,
      dailyDemandStandardDeviation: 1,
      leadTimeDays: 3,
      onHand: 2,
      orderMultiple: 0,
    })).toThrow('Order multiple must be greater than zero.');
  });
});

describe('classifyInventoryPortfolio', () => {
  it('classifies ABC by annual consumption value and XYZ by demand variability', () => {
    const result = classifyInventoryPortfolio([
      { productId: 'high-value-stable', annualUnitsConsumed: 100, unitCost: 10, periodDemand: [10, 10, 10, 10, 10, 10] },
      { productId: 'medium-value-variable', annualUnitsConsumed: 100, unitCost: 1, periodDemand: [0, 1, 2, 3, 4, 5] },
      { productId: 'low-value-erratic', annualUnitsConsumed: 10, unitCost: 1, periodDemand: [0, 0, 0, 0, 0, 10] },
      { productId: 'no-history', annualUnitsConsumed: 0, unitCost: 2, periodDemand: [] },
    ]);

    expect(result.find(item => item.productId === 'high-value-stable')).toMatchObject({ abcClass: 'A', xyzClass: 'X' });
    expect(result.find(item => item.productId === 'medium-value-variable')).toMatchObject({ abcClass: 'B', xyzClass: 'Y' });
    expect(result.find(item => item.productId === 'low-value-erratic')).toMatchObject({ abcClass: 'C', xyzClass: 'Z' });
    expect(result.find(item => item.productId === 'no-history')).toMatchObject({ abcClass: 'C', xyzClass: 'N' });
  });

  it('rejects duplicate product IDs and invalid portfolio inputs', () => {
    expect(() => classifyInventoryPortfolio([
      { productId: 'same', annualUnitsConsumed: 1, unitCost: 1, periodDemand: [] },
      { productId: 'same', annualUnitsConsumed: 1, unitCost: 1, periodDemand: [] },
    ])).toThrow('unique product ID');

    expect(() => classifyInventoryPortfolio([
      { productId: 'bad', annualUnitsConsumed: 1, unitCost: -1, periodDemand: [] },
    ])).toThrow('Unit cost must be a finite, non-negative number.');
  });
});
