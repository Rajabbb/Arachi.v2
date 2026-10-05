import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { freshDb } from "./test/helpers";
import { signToken, verifyToken } from "./links";

beforeEach(freshDb);

test("signed token round-trips and rejects tampering", () => {
  const token = signToken("dispatch", 42);
  assert.equal(verifyToken("dispatch", token), 42);
  assert.equal(verifyToken("other", token), null);
  const forged = Buffer.from("dispatch:43").toString("base64url") + "." + token.split(".")[1];
  assert.equal(verifyToken("dispatch", forged), null);
  assert.equal(verifyToken("dispatch", "garbage"), null);
});
