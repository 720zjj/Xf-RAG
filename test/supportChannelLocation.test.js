import test from 'node:test'
import assert from 'node:assert/strict'
import { getSupportChannelCode } from '../src/supportChannelLocation.js'

const validCode = 'Abcdefghijklmnopqrstuv'

test('parses an exact support URL-safe channel code', () => {
  assert.equal(
    getSupportChannelCode({ pathname: `/support/${validCode}`, search: '' }),
    validCode
  )
})

test('parses a support code with one trailing slash and ignores its query string', () => {
  assert.equal(
    getSupportChannelCode({ pathname: `/support/${validCode}/`, search: '?source=qr' }),
    validCode
  )
})

test('rejects malformed support URL paths', () => {
  for (const pathname of [
    '/support/short',
    `/support/${validCode}%2Fother`,
    `/documents/support/${validCode}`,
    `/support/${validCode}/more`
  ]) {
    assert.equal(getSupportChannelCode({ pathname, search: '' }), null, pathname)
  }
})
