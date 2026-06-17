/**
 * in-flight de-dupe + 완료 캐시 단위 테스트 (codex S1 → S2 이관).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupe, _resetDedupe } from '../src/lib/dedupe.js'

test('동시 호출은 fn 1회만 실행(in-flight 공유)', async () => {
  _resetDedupe()
  let calls = 0
  const fn = async () => {
    calls++
    await new Promise((r) => setTimeout(r, 20))
    return { n: calls }
  }
  const [a, b, c] = await Promise.all([dedupe('k', fn), dedupe('k', fn), dedupe('k', fn)])
  assert.equal(calls, 1)
  assert.deepEqual(a, { n: 1 })
  assert.deepEqual(b, { n: 1 })
  assert.deepEqual(c, { n: 1 })
})

test('완료 후 TTL 내 재호출은 캐시 반환', async () => {
  _resetDedupe()
  let calls = 0
  const fn = async () => ({ n: ++calls })
  await dedupe('k', fn, { ttlMs: 1000 })
  const second = await dedupe('k', fn, { ttlMs: 1000 })
  assert.equal(calls, 1)
  assert.deepEqual(second, { n: 1 })
})

test('TTL 만료 후에는 재실행', async () => {
  _resetDedupe()
  let calls = 0
  const fn = async () => ({ n: ++calls })
  await dedupe('k', fn, { ttlMs: 10 })
  await new Promise((r) => setTimeout(r, 25))
  const second = await dedupe('k', fn, { ttlMs: 10 })
  assert.equal(calls, 2)
  assert.deepEqual(second, { n: 2 })
})

test('서로 다른 키는 독립 실행', async () => {
  _resetDedupe()
  let calls = 0
  const fn = async () => ({ n: ++calls })
  await Promise.all([dedupe('k1', fn), dedupe('k2', fn)])
  assert.equal(calls, 2)
})

test('실패(reject)는 캐시하지 않음 — 다음 호출 재시도', async () => {
  _resetDedupe()
  let calls = 0
  const fn = async () => {
    calls++
    throw new Error('boom')
  }
  await assert.rejects(() => dedupe('k', fn))
  await assert.rejects(() => dedupe('k', fn))
  assert.equal(calls, 2) // 캐시 안 됨 → 2회 호출
})
