import { describe, expect, it } from "vitest";
import { limitWords, wordCount } from "./text";

describe("limitWords", () => {
  it("leaves short text alone", () => {
    expect(limitWords("Check the cable.", 25)).toBe("Check the cable.");
  });
  it("trims at the last complete sentence within the limit", () => {
    const t =
      "Unplug it first. Then look inside the port with a light and check for lint or dust buildup carefully.";
    expect(limitWords(t, 10)).toBe("Unplug it first.");
  });
  it("cuts one long sentence at the limit and adds an ellipsis", () => {
    const t = "one two three four five six seven eight nine ten eleven twelve";
    const out = limitWords(t, 5);
    expect(out).toBe("one two three four five…");
    expect(wordCount(out)).toBe(5);
  });
  it("counts words by whitespace", () => {
    expect(wordCount("  a\nb\tc  ")).toBe(3);
  });
  it("never returns more than the limit", () => {
    const t = Array.from({ length: 80 }, (_, i) => `w${i}${i % 7 === 6 ? "." : ""}`).join(" ");
    for (const max of [15, 25]) expect(wordCount(limitWords(t, max))).toBeLessThanOrEqual(max);
  });
});

import { signInMessage } from "./auth-messages";
describe("sign-in messages", () => {
  it("maps common errors to plain sentences", () => {
    expect(signInMessage("Invalid login credentials")).toBe("Wrong email or password.");
    expect(signInMessage("Email not confirmed")).toBe("Confirm your email first, then sign in.");
    expect(signInMessage("Request rate limit reached")).toBe(
      "Too many attempts. Wait a minute and try again.",
    );
    expect(signInMessage("Failed to fetch")).toBe(
      "No connection. Check your internet and try again.",
    );
    expect(signInMessage("weird")).toBe("Couldn't sign you in. Try again.");
  });
});
