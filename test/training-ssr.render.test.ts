import { test } from 'node:test';
import assert from 'node:assert/strict';
import './support/tsx-register.mjs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const TrainingSource = (await import('@/app/(dashboard)/training/[slug]/training-source.tsx')).default;

test('Coach renders on the server without reading the native bridge or requiring window', () => {
  assert.equal(typeof window, 'undefined');
  const html = renderToStaticMarkup(React.createElement(TrainingSource, {
    slug: 'video-studio', ownerId: 'test-owner', recentRuns: [],
  }));
  assert.match(html, /Teach video-studio/);
  assert.match(html, /Show it/);
  assert.match(html, /Say it/);
});
