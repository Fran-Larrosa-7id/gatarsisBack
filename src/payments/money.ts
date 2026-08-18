export const centsToMercadoPagoAmount = (cents: number): number => cents / 100;
export const mercadoPagoAmountToCents = (amount: number): number =>
  Math.round(amount * 100);
