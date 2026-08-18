import { DomainError } from '../common/domain-error';
import { CheckoutService } from './checkout.service';

describe('CheckoutService input guards', () => {
  const service = new CheckoutService({ transaction: jest.fn() } as never, {} as never);
  it('requires an idempotency key before opening a transaction', async () => {
    await expect(service.reserve({ items: [{ variantId: '00000000-0000-4000-8000-000000000001', quantity: 1 }] }, '')).rejects.toMatchObject<Partial<DomainError>>({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });
});
