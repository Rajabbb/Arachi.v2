import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { freshDb } from "./test/helpers";
import { signToken, verifyToken } from "./links";

beforeEach(freshDb);

test("signed token round-trips and rejects tampering", async () => {
  const token = await signToken("dispatch", 42);
  assert.equal(await verifyToken("dispatch", token), 42);
  assert.equal(await verifyToken("other", token), null);
  const forged = Buffer.from("dispatch:43").toString("base64url") + "." + token.split(".")[1];
  assert.equal(await verifyToken("dispatch", forged), null);
  assert.equal(await verifyToken("dispatch", "garbage"), null);
});

test("a token with an expiry stops working after it", async () => {
  const token = await signToken("file", 7, 60);
  assert.equal(await verifyToken("file", token), 7);
  const later = Date.now;
  Date.now = () => later() + 61_000;
  try {
    assert.equal(await verifyToken("file", token), null);
    assert.equal(await verifyToken("file", token, { ignoreExpiry: true }), 7);
  } finally {
    Date.now = later;
  }
  // A token signed without expiry is refused where one is required.
  assert.equal(await verifyToken("file", await signToken("file", 7), { requireExpiry: true }), null);
});
