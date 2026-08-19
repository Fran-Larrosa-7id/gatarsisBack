import { createHmac } from 'crypto';
import { InvalidWebhookSignatureError, SignatureFailureReason, WebhookSignatureValidator } from 'mercadopago';

describe('Mercado Pago webhook signatures', () => {
  const secret = 'test-webhook-secret';
  const dataId = '123456';
  const requestId = 'request-abc';
  const timestamp = '1700000000';
  const signatureFor = (value = timestamp, id = dataId, request = requestId) => `ts=${value},v1=${createHmac('sha256', secret).update(`id:${id};request-id:${request};ts:${value};`).digest('hex')}`;
  const validate = (xSignature = signatureFor(), now = Number(timestamp) * 1000) => WebhookSignatureValidator.validate({ xSignature, xRequestId: requestId, dataId, secret, toleranceSeconds: 300, now: () => now });

  it('accepts a recent valid signature', () => {
    expect(() => validate()).not.toThrow();
  });

  it('rejects an invalid signature', () => {
    expect(() => validate(`ts=${timestamp},v1=not-a-valid-hash`)).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects a signature when x-request-id differs from the signed value', () => {
    expect(() => WebhookSignatureValidator.validate({ xSignature: signatureFor(), xRequestId: 'other-request', dataId, secret, toleranceSeconds: 300, now: () => Number(timestamp) * 1000 })).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects a signature when data.id differs from the signed query value', () => {
    expect(() => WebhookSignatureValidator.validate({ xSignature: signatureFor(), xRequestId: requestId, dataId: '654321', secret, toleranceSeconds: 300, now: () => Number(timestamp) * 1000 })).toThrow(InvalidWebhookSignatureError);
  });

  it('rejects a signature whose timestamp is outside tolerance', () => {
    try { validate(signatureFor(), Number(timestamp) * 1000 + 301_000); } catch (error) { expect(error).toMatchObject({ reason: SignatureFailureReason.TimestampOutOfTolerance }); return; }
    throw new Error('Expected the validator to reject an old signature');
  });
});
