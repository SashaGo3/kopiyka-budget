import { describe, expect, test } from "bun:test";
import { LOGOS, guessLogo, parsePaymentIcon, resolvePaymentIcon, searchLogos } from "../src/logos";

describe("payment icons", () => {
  test("a bank's spelling of a payee finds its mark", () => {
    expect(guessLogo("NETFLIX.COM AMSTERDAM")?.slug).toBe("netflix");
    expect(guessLogo("Spotify P2A3B4C5")?.slug).toBe("spotify");
    expect(guessLogo("APPLE.COM/BILL")?.slug).toBe("apple");
  });
  test("the longer name wins, and a name in front of someone else's loses", () => {
    expect(guessLogo("Apple Music")?.slug).toBe("applemusic");
    expect(guessLogo("PAYPAL *NETFLIX")?.slug).toBe("netflix");
    expect(guessLogo("GOOGLE *YouTube Premium")?.slug).toBe("youtube");
    expect(guessLogo("PAYPAL *SOMESHOP")?.slug).toBe("paypal");
  });
  test("whole words only, and generic words are never guessed", () => {
    expect(guessLogo("Boxing club")).toBeNull();
    expect(guessLogo("Signal Iduna insurance")).toBeNull();
    expect(guessLogo("Orange juice")).toBeNull();
    expect(guessLogo("Rent")).toBeNull();
  });
  test("a chosen icon outranks the guess; 'category' asks for none", () => {
    expect(resolvePaymentIcon({ icon: "emoji:🎬", payee: "Netflix" })).toEqual({ kind: "emoji", emoji: "🎬" });
    expect(resolvePaymentIcon({ icon: "category", payee: "Netflix" })).toEqual({ kind: "category" });
    expect(resolvePaymentIcon({ icon: null, payee: "Gym", match_payee: "SPOTIFY AB" })).toMatchObject({ kind: "logo", logo: { slug: "spotify" } });
    expect(resolvePaymentIcon({ icon: null, payee: "Rent" })).toEqual({ kind: "category" });
  });
  test("an unknown value degrades to a guess", () => {
    expect(parsePaymentIcon("logo:nonexistent")).toBeNull();
    expect(parsePaymentIcon("future:thing")).toBeNull();
    expect(parsePaymentIcon("sf:tv")).toEqual({ kind: "sf", name: "tv" });
  });
  test("search finds by title start first", () => {
    expect(searchLogos("net")[0]?.slug).toBe("netflix");
    expect(searchLogos("").length).toBe(LOGOS.length);
    expect(LOGOS.every((l) => /^[0-9A-F]{6}$/i.test(l.hex))).toBe(true);
  });
});

describe("names in other alphabets", () => {
  test("Cyrillic and Polish payees find their marks", () => {
    expect(guessLogo("Київстар поповнення")?.slug).toBe("kyivstar");
    expect(guessLogo("MONOBANK*PLATA")?.slug).toBe("monobank");
    expect(guessLogo("Opłata Medicover Sport")?.slug).toBe("medicover");
    expect(guessLogo("Disney Plus")?.slug).toBe("disney");
  });
  test("a generic word stays unguessed", () => {
    expect(guessLogo("Play date")).toBeNull();
    expect(guessLogo("Calm evening")).toBeNull();
  });
});

describe("stored pictures", () => {
  test("only a small PNG or JPEG the app could have written", () => {
    expect(parsePaymentIcon("img:data:image/png;base64,iVBORw0KGgo=")).toEqual({ kind: "img", uri: "data:image/png;base64,iVBORw0KGgo=" });
    expect(parsePaymentIcon("img:data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(parsePaymentIcon("img:data:image/tiff;base64,SUkqAA==")).toBeNull();
    expect(parsePaymentIcon("img:https://example.com/x.png")).toBeNull();
    expect(parsePaymentIcon(`img:data:image/png;base64,${"A".repeat(300 * 1024)}`)).toBeNull();
  });
});
