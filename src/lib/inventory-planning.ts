export interface DailyDemandObservation {
  /** Units sold during one calendar day. Zero-demand in-stock days are meaningful. */
  unitsSold: number;
  /** Stockout days are excluded because observed sales are censored by unavailable stock. */
  wasStockout: boolean;
}

export interface DemandStatistics {
  averageDailyDemand: number;
  dailyDemandStandardDeviation: number;
  coefficientOfVariation: number | null;
  observedDays: number;
  excludedStockoutDays: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface ReplenishmentInput {
  averageDailyDemand: number;
  dailyDemandStandardDeviation: number;
  leadTimeDays: number;
  onHand: number;
  reserved?: number;
  quarantined?: number;
  onOrder?: number;
  backorders?: number;
  /** Standard-normal Z value for the selected service level (95% ~= 1.645). */
  serviceLevelZ?: number;
  safetyStockOverride?: number;
  reorderPointOverride?: number;
  targetDaysOfCover?: number;
  minimumOrderQuantity?: number;
  orderMultiple?: number;
  demandConfidence?: DemandStatistics['confidence'];
}

export interface ReplenishmentPlan {
  safetyStock: number;
  reorderPoint: number;
  inventoryPosition: number;
  targetStock: number;
  suggestedOrderQuantity: number;
  shouldReorder: boolean;
  confidence: DemandStatistics['confidence'];
  explanation: string[];
}

export interface InventoryPortfolioItem {
  productId: string;
  annualUnitsConsumed: number;
  unitCost: number;
  /** Periodic demand observations, normally the last 6–12 complete months. */
  periodDemand: number[];
}

export interface InventoryPortfolioClassification {
  productId: string;
  annualConsumptionValue: number;
  abcClass: 'A' | 'B' | 'C';
  xyzClass: 'X' | 'Y' | 'Z' | 'N';
  coefficientOfVariation: number | null;
}

/**
 * Calculate demand from complete daily observations. Days with a stockout are
 * excluded to avoid treating unavailable inventory as zero customer demand.
 * Callers should use a consistent date window and disclose excluded days.
 */
export function calculateDemandStatistics(
  observations: DailyDemandObservation[],
): DemandStatistics {
  if (!Array.isArray(observations)) {
    throw new Error('Demand observations must be an array.');
  }

  const availableDemand: number[] = [];
  let excludedStockoutDays = 0;

  for (const observation of observations) {
    if (!Number.isFinite(observation.unitsSold) || observation.unitsSold < 0) {
      throw new Error('Daily units sold must be a finite, non-negative number.');
    }
    if (typeof observation.wasStockout !== 'boolean') {
      throw new Error('Every demand observation must identify whether a stockout occurred.');
    }
    if (observation.wasStockout) {
      excludedStockoutDays += 1;
    } else {
      availableDemand.push(observation.unitsSold);
    }
  }

  const observedDays = availableDemand.length;
  const averageDailyDemand = observedDays
    ? availableDemand.reduce((sum, value) => sum + value, 0) / observedDays
    : 0;
  const variance = observedDays
    ? availableDemand.reduce((sum, value) => sum + ((value - averageDailyDemand) ** 2), 0) / observedDays
    : 0;
  const dailyDemandStandardDeviation = Math.sqrt(variance);
  const coefficientOfVariation = averageDailyDemand > 0
    ? dailyDemandStandardDeviation / averageDailyDemand
    : null;
  const totalDays = observedDays + excludedStockoutDays;
  const stockoutShare = totalDays ? excludedStockoutDays / totalDays : 0;

  let confidence: DemandStatistics['confidence'] = 'low';
  if (observedDays >= 56 && stockoutShare <= 0.1) {
    confidence = 'high';
  } else if (observedDays >= 28 && stockoutShare <= 0.25) {
    confidence = 'medium';
  }

  return {
    averageDailyDemand,
    dailyDemandStandardDeviation,
    coefficientOfVariation,
    observedDays,
    excludedStockoutDays,
    confidence,
  };
}

function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite, non-negative number.`);
  }
}

function roundQuantity(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Produce an explainable reorder suggestion. This function never creates a
 * purchase order; an authorized user must review and approve the recommendation.
 */
export function calculateReplenishmentPlan(input: ReplenishmentInput): ReplenishmentPlan {
  const {
    averageDailyDemand,
    dailyDemandStandardDeviation,
    leadTimeDays,
    onHand,
    reserved = 0,
    quarantined = 0,
    onOrder = 0,
    backorders = 0,
    serviceLevelZ = 1.645,
    targetDaysOfCover = 30,
    minimumOrderQuantity = 1,
    orderMultiple = 1,
    demandConfidence = 'low',
  } = input;

  const values: Array<[string, number]> = [
    ['Average daily demand', averageDailyDemand],
    ['Daily demand standard deviation', dailyDemandStandardDeviation],
    ['Supplier lead time', leadTimeDays],
    ['On-hand quantity', onHand],
    ['Reserved quantity', reserved],
    ['Quarantined quantity', quarantined],
    ['On-order quantity', onOrder],
    ['Backorder quantity', backorders],
    ['Service-level Z value', serviceLevelZ],
    ['Target days of cover', targetDaysOfCover],
    ['Minimum order quantity', minimumOrderQuantity],
    ['Order multiple', orderMultiple],
  ];
  values.forEach(([name, value]) => assertNonNegative(name, value));
  if (reserved + quarantined > onHand) {
    throw new Error('Reserved and quarantined quantities cannot exceed on-hand stock.');
  }
  if (orderMultiple <= 0) {
    throw new Error('Order multiple must be greater than zero.');
  }
  if (input.safetyStockOverride !== undefined) {
    assertNonNegative('Safety stock override', input.safetyStockOverride);
  }
  if (input.reorderPointOverride !== undefined) {
    assertNonNegative('Reorder point override', input.reorderPointOverride);
  }

  const safetyStock = input.safetyStockOverride
    ?? (serviceLevelZ * dailyDemandStandardDeviation * Math.sqrt(leadTimeDays));
  const reorderPoint = input.reorderPointOverride
    ?? (averageDailyDemand * leadTimeDays + safetyStock);
  const available = onHand - reserved - quarantined;
  const inventoryPosition = available + onOrder - backorders;
  const targetStock = Math.max(
    reorderPoint,
    averageDailyDemand * targetDaysOfCover + safetyStock,
  );
  const shouldReorder = inventoryPosition <= reorderPoint;
  const rawRequirement = Math.max(0, targetStock - inventoryPosition);
  // Apply the MOQ before rounding to the supplier's pack multiple. Taking
  // max(MOQ, rounded requirement) can otherwise return a quantity that is
  // not divisible by the required order multiple (e.g. MOQ 10, pack 6 -> 10).
  const minimumCompliantOrder = Math.ceil((minimumOrderQuantity - 1e-10) / orderMultiple) * orderMultiple;
  const roundedRequirement = rawRequirement > 0
    ? Math.ceil((rawRequirement - 1e-10) / orderMultiple) * orderMultiple
    : 0;
  const suggestedOrderQuantity = shouldReorder && rawRequirement > 0
    ? Math.max(minimumCompliantOrder, roundedRequirement)
    : 0;

  const explanation = [
    `Available stock: ${roundQuantity(available)} (on hand less reservations and quarantine).`,
    `Inventory position: ${roundQuantity(inventoryPosition)} (available plus on-order less backorders).`,
    `Reorder point: ${roundQuantity(reorderPoint)} based on lead-time demand and safety stock.`,
  ];
  if (shouldReorder) {
    explanation.push(
      `Review an order for ${roundQuantity(suggestedOrderQuantity)} units; pack multiple is ${roundQuantity(orderMultiple)} and minimum order is ${roundQuantity(minimumOrderQuantity)}.`,
    );
  } else {
    explanation.push('No order is suggested because inventory position is above the reorder point.');
  }
  if (demandConfidence !== 'high') {
    explanation.push('Demand history is not high-confidence; review the demand window and stockout days before approving.');
  }

  return {
    safetyStock: roundQuantity(safetyStock),
    reorderPoint: roundQuantity(reorderPoint),
    inventoryPosition: roundQuantity(inventoryPosition),
    targetStock: roundQuantity(targetStock),
    suggestedOrderQuantity: roundQuantity(suggestedOrderQuantity),
    shouldReorder,
    confidence: demandConfidence,
    explanation,
  };
}

/**
 * ABC uses annual consumption value; XYZ uses demand coefficient of variation.
 * X <= 0.50, Y <= 1.00, Z > 1.00. Fewer than six periods or zero mean demand
 * is marked N (not classifiable), not silently treated as stable demand.
 */
export function classifyInventoryPortfolio(
  items: InventoryPortfolioItem[],
): InventoryPortfolioClassification[] {
  if (!Array.isArray(items)) {
    throw new Error('Portfolio items must be an array.');
  }

  const seen = new Set<string>();
  const enriched = items.map(item => {
    if (!item.productId.trim() || seen.has(item.productId)) {
      throw new Error('Every portfolio item must have a unique product ID.');
    }
    seen.add(item.productId);
    assertNonNegative('Annual units consumed', item.annualUnitsConsumed);
    assertNonNegative('Unit cost', item.unitCost);
    if (!Array.isArray(item.periodDemand) || item.periodDemand.some(value => !Number.isFinite(value) || value < 0)) {
      throw new Error('Period demand must contain only finite, non-negative values.');
    }
    const annualConsumptionValue = item.annualUnitsConsumed * item.unitCost;
    const mean = item.periodDemand.length
      ? item.periodDemand.reduce((sum, value) => sum + value, 0) / item.periodDemand.length
      : 0;
    const variance = item.periodDemand.length
      ? item.periodDemand.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / item.periodDemand.length
      : 0;
    const coefficientOfVariation = mean > 0 && item.periodDemand.length >= 6
      ? Math.sqrt(variance) / mean
      : null;
    const xyzClass: InventoryPortfolioClassification['xyzClass'] = coefficientOfVariation === null
      ? 'N'
      : coefficientOfVariation <= 0.5 ? 'X'
        : coefficientOfVariation <= 1 ? 'Y' : 'Z';

    return { productId: item.productId, annualConsumptionValue, coefficientOfVariation, xyzClass };
  });

  const ranked = [...enriched].sort((a, b) =>
    b.annualConsumptionValue - a.annualConsumptionValue
      || a.productId.localeCompare(b.productId),
  );
  const totalValue = ranked.reduce((sum, item) => sum + item.annualConsumptionValue, 0);
  let cumulativeValue = 0;
  const abcByProduct = new Map<string, InventoryPortfolioClassification['abcClass']>();

  for (const item of ranked) {
    const cumulativeShareBeforeItem = totalValue > 0 ? cumulativeValue / totalValue : 1;
    const abcClass: InventoryPortfolioClassification['abcClass'] = item.annualConsumptionValue === 0
      ? 'C'
      : cumulativeShareBeforeItem < 0.8 ? 'A'
        : cumulativeShareBeforeItem < 0.95 ? 'B' : 'C';
    abcByProduct.set(item.productId, abcClass);
    cumulativeValue += item.annualConsumptionValue;
  }

  return enriched.map(item => ({
    ...item,
    annualConsumptionValue: roundQuantity(item.annualConsumptionValue),
    abcClass: abcByProduct.get(item.productId) ?? 'C',
    coefficientOfVariation: item.coefficientOfVariation === null
      ? null
      : roundQuantity(item.coefficientOfVariation),
  }));
}

export interface MinMaxReplenishmentInput {
  available: number;
  incoming: number;
  reorderPoint: number;
  targetStock: number | null;
}

export interface MinMaxReplenishmentResult {
  inventoryPosition: number;
  shouldReorder: boolean;
  targetConfigured: boolean;
  suggestedQuantity: number;
}

/**
 * Deterministic location-level min/max planning. Incoming quantities count only
 * after dispatch; callers must exclude drafts, canceled and unapproved transfers.
 * A missing or non-useful target never produces an invented order quantity.
 */
export function calculateMinMaxReplenishment(
  input: MinMaxReplenishmentInput,
): MinMaxReplenishmentResult {
  assertNonNegative('Available quantity', input.available);
  assertNonNegative('Incoming quantity', input.incoming);
  assertNonNegative('Reorder point', input.reorderPoint);
  if (input.targetStock !== null) {
    assertNonNegative('Target stock quantity', input.targetStock);
  }

  const inventoryPosition = roundQuantity(input.available + input.incoming);
  const shouldReorder = inventoryPosition <= input.reorderPoint;
  const targetConfigured = input.targetStock !== null
    && input.targetStock > input.reorderPoint;
  const suggestedQuantity = shouldReorder && targetConfigured
    ? roundQuantity(Math.max(0, input.targetStock! - inventoryPosition))
    : 0;

  return {
    inventoryPosition,
    shouldReorder,
    targetConfigured,
    suggestedQuantity,
  };
}


export interface ReplenishmentBalanceRow {
  id: string;
  location_id: string;
  product_id: string;
  available_quantity: number;
}

export interface ReplenishmentSettingRow {
  location_id: string;
  product_id: string;
}

export interface ReplenishmentLocationProductRow {
  id: string;
  locationId: string;
  productId: string;
  available: number;
}

/**
 * Build the union of stock, explicitly configured and inbound location/product
 * pairs. A missing balance row is zero available stock, not an absent SKU.
 */
export function buildReplenishmentLocationProductRows(
  balances: ReplenishmentBalanceRow[],
  settings: ReplenishmentSettingRow[],
  incoming: ReadonlyMap<string, number> = new Map(),
): ReplenishmentLocationProductRow[] {
  const balanceByKey = new Map<string, ReplenishmentBalanceRow>();
  const pairs = new Map<string, { locationId: string; productId: string }>();

  const addPair = (locationId: string, productId: string) => {
    const key = `${locationId}:${productId}`;
    if (!pairs.has(key)) pairs.set(key, { locationId, productId });
    return key;
  };

  for (const balance of balances) {
    const key = addPair(balance.location_id, balance.product_id);
    balanceByKey.set(key, balance);
  }
  for (const setting of settings) addPair(setting.location_id, setting.product_id);
  for (const key of incoming.keys()) {
    const separator = key.indexOf(':');
    if (separator > 0 && separator < key.length - 1) {
      addPair(key.slice(0, separator), key.slice(separator + 1));
    }
  }

  return Array.from(pairs.entries()).map(([key, pair]) => {
    const balance = balanceByKey.get(key);
    return {
      id: balance?.id ?? key,
      locationId: pair.locationId,
      productId: pair.productId,
      available: balance ? Number(balance.available_quantity) : 0,
    };
  });
}
