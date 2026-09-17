import test from "node:test";
import assert from "node:assert/strict";
import { RateLimitScope } from "../src/rate-scope.js";
const sample = { origin: "https://example.org", retryAfter: "120", observedAt: 1 };
const setup = () => {
  const seen: any[] = [];
  const scope = new RateLimitScope<object, object>((e) => seen.push(e));
  const page = {}, other = {};
  scope.control("job-a", 1);
  scope.bind(page, "job-a", 1);
  return { scope, other, seen };
};

test("late response from an existing page's pre-binding request is not adopted", () => {
  const { scope, other, seen } = setup(), request = {};
  scope.request(request, other);
  scope.bind(other, "job-a", 1);
  assert.equal(scope.response(request, sample), false);
  assert.equal(seen.length, 0);
});

test("a verified new page can attribute initial headers received after its binding", () => {
  const { scope, other, seen } = setup(), request = {};
  scope.request(request);
  scope.bind(other, "job-a", 1, true);
  assert.equal(scope.response(request, sample, other), true);
  assert.equal(seen.length, 1);
});
