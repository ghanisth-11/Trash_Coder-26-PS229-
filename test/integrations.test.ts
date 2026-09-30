import test from 'node:test';
import assert from 'node:assert/strict';
import { realIntegrations, validateImageInput } from '../src/integrations.js';
test('Gemini performs three ordered calls, passes images only to vision chains and forces copper QC', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const calls: Array<{
    contents: Array<{ parts: Array<Record<string, unknown>> }>;
    generationConfig: Record<string, unknown>;
  }> = [];
  const outputs = [
    'A copper PCB.',
    JSON.stringify({
      name: 'Circuit board',
      category: 'Copper Scrap',
      subType: 'PCB',
      condition: 'damaged',
      isEwaste: false,
      needsOperatorQC: false,
      keyComponents: ['copper'],
      confidence: 'medium',
    }),
    JSON.stringify({
      buyPrice: 10,
      sellPrice: 20,
      priceUnit: 'per_kg',
      currency: 'INR',
      priceNote: 'Estimate.',
      marketTrend: 'stable',
    }),
  ];
  globalThis.fetch = async (_input, init) => {
    calls.push(JSON.parse(init!.body as string));
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: outputs[calls.length - 1] }] }, finishReason: 'STOP' },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const result = await realIntegrations().detect({
      buffer: Buffer.from('test'),
      mimetype: 'image/png',
    });
    assert.equal(calls.length, 3);
    assert.equal(calls[0]!.contents[0]!.parts.length, 2);
    assert.equal(calls[1]!.contents[0]!.parts.length, 2);
    assert.equal(calls[2]!.contents[0]!.parts.length, 1);
    assert.match(String(calls[1]!.contents[0]!.parts[0]!.text), /A copper PCB/);
    assert.equal(result.detection.needsOperatorQC, true);
    assert.equal(result.detection.category, 'copper-scrap');
    assert.equal(result.provenance.model, 'gemini-2.5-flash');
    assert.equal(result.provenance.promptVersion, 'scrap-v1');
    assert.deepEqual(result.provenance.classification, result.detection);
    assert.match(result.price.priceNote, /verify locally/i);
    assert.deepEqual(
      calls.map((c) => c.generationConfig.maxOutputTokens),
      [600, 400, 200],
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
test('Cloudinary input validation rejects forged signatures and oversized images before upload', () => {
  assert.throws(() =>
    validateImageInput({
      buffer: Buffer.from('<script>not an image</script>'),
      mimetype: 'image/png',
    }),
  );
  assert.throws(() =>
    validateImageInput({ buffer: Buffer.alloc(8 * 1024 * 1024 + 1), mimetype: 'image/png' }),
  );
});
test('Gemini rejects malformed structured output', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not JSON' }] } }] }));
  try {
    await assert.rejects(realIntegrations().estimate('paper'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
