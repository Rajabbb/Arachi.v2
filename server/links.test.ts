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
