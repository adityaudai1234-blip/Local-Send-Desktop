/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatChunkSize, formatEta, formatSpeed } from './formatters';

test('formatBytes handles zero, negative, non-finite, and >4GB 64-bit sizes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(-50), '0 B');
  assert.equal(formatBytes(Number.NaN), '0 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(5 * 1024 * 1024 * 1024), '5 GB');
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024 * 1024), '2 TB');
});

test('formatSpeed formats throughput accurately across B/s to GB/s', () => {
  assert.equal(formatSpeed(0), '0 B/s');
  assert.equal(formatSpeed(-10), '0 B/s');
  assert.equal(formatSpeed(512), '512 B/s');
  assert.equal(formatSpeed(10 * 1024), '10 KB/s');
  assert.equal(formatSpeed(15.5 * 1024 * 1024), '15.5 MB/s');
  assert.equal(formatSpeed(1.25 * 1024 * 1024 * 1024), '1.3 GB/s');
});

test('formatEta suppresses unreliable or missing ETAs with Calculating...', () => {
  assert.equal(formatEta(undefined, true), 'Calculating...');
  assert.equal(formatEta(null, true), 'Calculating...');
  assert.equal(formatEta(12, false), 'Calculating...');
  assert.equal(formatEta(-3, true), 'Calculating...');
  assert.equal(formatEta(0, true), '< 1s');
  assert.equal(formatEta(45, true), '45s');
  assert.equal(formatEta(125, true), '2m 5s');
  assert.equal(formatEta(3660, true), '1h 1m');
});

test('formatChunkSize formats KB and MB chunk allocations cleanly', () => {
  assert.equal(formatChunkSize(0), '256 KB');
  assert.equal(formatChunkSize(64 * 1024), '64 KB');
  assert.equal(formatChunkSize(256 * 1024), '256 KB');
  assert.equal(formatChunkSize(1024 * 1024), '1 MB');
  assert.equal(formatChunkSize(4 * 1024 * 1024), '4 MB');
});
