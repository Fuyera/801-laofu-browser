import test from "node:test";
import assert from "node:assert/strict";
import { RateLimitScope } from "../src/rate-scope.js";
const sample = { origin: "https://example.org", retryAfter: "120", observedAt: 1 };
const setup = () => {
  const seen: any[] = [], scope = new RateLimitScope<object, object>((e) => seen.push(e));
  const page = {}, other = {}; scope.control("job-a", 1); scope.bind(page, "job-a", 1);
  return { scope, page, other, seen };
};
test("unrelated page 429 does not cancel the active page, even with identical origin", () => {
  const { scope, other, seen } = setup(), request = {};
  scope.request(request, other); assert.equal(scope.response(request, sample), false); assert.equal(seen.length, 0);
});
test("active main document and related cross-origin resources carry execution identity", () => {
  const { scope, page, seen } = setup();
  for (const origin of [sample.origin, "https://cdn.example.org"]) {
    const request = {}; scope.request(request, page); assert.equal(scope.response(request, { ...sample, origin }), true);
  }
  assert.deepEqual(seen.map((e) => [e.jobId, e.fence]), [["job-a", 1], ["job-a", 1]]);
});
test("old request arriving after a new job on the same page is ignored", () => {
  const { scope, page, seen } = setup(), request = {}; scope.request(request, page);
  scope.control("job-b", 2); scope.bind(page, "job-b", 2);
  assert.equal(scope.response(request, sample), false); assert.equal(seen.length, 0);
});
test("pause/resume fences out requests from before or during human control", () => {
  const { scope, page, seen } = setup(), before = {}, during = {};
  scope.request(before, page); scope.control("job-a", 1, true); scope.request(during, page); scope.control("job-a", 1);
  assert.equal(scope.response(before, sample), false); assert.equal(scope.response(during, sample), false); assert.equal(seen.length, 0);
});
test("new tab initial response is adopted only after exact page identity is bound", () => {
  const { scope, other, seen } = setup(), request = {};
  scope.request(request, other); scope.response(request, sample);
  scope.bind({}, "job-a", 1, true); assert.equal(seen.length, 0);
  scope.bind(other, "job-a", 1, true); assert.equal(seen.length, 1);
});
test("binding an existing tab never adopts its earlier background 429", () => {
  const { scope, other, seen } = setup(), request = {};
  scope.request(request, other); scope.response(request, sample);
  scope.bind(other, "job-a", 1); assert.equal(seen.length, 0);
});
test("late frame availability can resolve page identity, but missing request origin cannot", () => {
  const { scope, page, seen } = setup(), request = {};
  scope.request(request); assert.equal(scope.response(request, sample, page), true);
  assert.equal(scope.response({}, sample, page), false); assert.equal(seen.length, 1);
});
test("late binding from an old job cannot claim a page in a new generation", () => {
  const { scope, other, seen } = setup(); scope.control("job-b", 2); scope.bind(other, "job-a", 1, true);
  const request = {}; scope.request(request, other); assert.equal(scope.response(request, sample), false); assert.equal(seen.length, 0);
});
test("clear releases scope and rejects delayed responses", () => {
  const { scope, page, seen } = setup(), request = {}; scope.request(request, page); scope.clear();
  assert.equal(scope.response(request, sample), false); assert.equal(seen.length, 0);
});
