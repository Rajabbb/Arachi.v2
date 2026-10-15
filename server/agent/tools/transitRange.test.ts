import assert from "node:assert/strict";
import { test } from "node:test";
import { cardFor } from "./toolCards";

/** A carrier may quote an approximate range ("5-12 gün"); the number column keeps its upper bound. */

test("an offer's approximate transit range is shown instead of the single number", () => {
  const card = cardFor.compare_offers!(
    {
      criterion: "price",
      rankings: [
        {
          currency: "USD",
          offers: [
            { rank: 1, carrier: "Road A", price: 900, currency: "USD", transit_days: 12, transit_range: "5-12" },
            { rank: 2, carrier: "Road B", price: 950, currency: "USD", transit_days: 7 },
          ],
        },
      ],
    },
    {},
  );
  const text = JSON.stringify(card);
  assert.match(text, /Road A.*5-12 gün/);
  assert.match(text, /Road B.*7 gün/);
  assert.doesNotMatch(text, /[^-0-9]12 gün/, "the upper bound alone is not shown when a range exists");
});

test("the winner card shows the range too", () => {
  const card = cardFor.select_winner!({ rfq_id: 4, winner: { carrier: "Road A", price: 900, currency: "USD", transit_days: 12, transit_range: "5-12" } }, {});
  assert.match(JSON.stringify(card), /5-12 gün/);
});
