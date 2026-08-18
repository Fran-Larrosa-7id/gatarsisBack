import { createHmac } from 'crypto';
import { InvalidWebhookSignatureError, SignatureFailureReason, WebhookSignatureValidator } from 'mercadopago';

describe('Mercado Pago webhook signatures', () => {
  const secret = 'test-webhook-secret';
  const dataId = '123456';
  const requestId = 'request-abc';
  const timestamp = '1700000000';
  const signatureFor = (value = timestamp) => `ts=${value},v1=${createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${value};`).digest('hex')}`;
  const validate = (xSignature = signatureFor(), now = Number(timestamp) * 1000) => WebhookSignatureValidator.validate({ xSignature, xRequestId: requestId, dataId, secret, toleranceSeconds: 300, now: () => now });

  it('accepts a recent valid signature', () => {
    expect(() => validate()).not.toThrow();
  });

  it('rejects an invalid signature', () => {
    expect(() => validate(`ts=${timestamp},v1=not-a-valid-hash`)).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects a signature whose timestamp is outside tolerance', () => {
    try { validate(signatureFor(), Number(timestamp) * 1000 + 301_000); } catch (error) { expect(error).toMatchObject({ reason: SignatureFailureReason.TimestampOutOfTolerance }); return; }
    throw new Error('Expected the validator to reject an old signature');
  });
});
