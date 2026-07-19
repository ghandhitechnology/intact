const secret = process.env.CODEX_MODERATION_SECRET;
const url = process.env.CODEX_MODERATION_URL || 'http://codex-moderation:8787';
if (!secret) throw new Error('CODEX_MODERATION_SECRET is required');

const health = await fetch(`${url}/health`);
if (!health.ok) throw new Error(`Adapter health failed: ${await health.text()}`);
const form = new FormData();
form.set('payload', JSON.stringify({
  submissionId: 'compatibility-probe', originalText: '안전한 호환성 검사 문장입니다.',
  reconstructedText: '안전한 호환성 검사 문장입니다.', ocrText: '', localSignals: {}, imageSignals: [],
}));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
form.append('images', new Blob([png], { type: 'image/png' }), 'known-safe.png');
const response = await fetch(`${url}/v1/classify`, {
  method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: form,
});
if (!response.ok) throw new Error(`Luna probe failed: ${await response.text()}`);
const verdict = await response.json();
const required = ['decision', 'confidence', 'categories', 'targetSpans', 'evidence', 'safeContext', 'evasionDetected', 'explanationKo'];
if (!required.every((key) => Object.hasOwn(verdict, key))) throw new Error('Luna probe did not match the verdict schema');
console.info(JSON.stringify({ ok: true, health: await health.json(), verdict }));
