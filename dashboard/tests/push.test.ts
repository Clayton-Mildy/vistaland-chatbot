import { it, expect } from "vitest";
import { urlBase64ToUint8Array } from "@/lib/push";

it("decodes base64 into bytes", () => {
  expect(urlBase64ToUint8Array("AQID")).toEqual(new Uint8Array([1, 2, 3]));
});

it("decodes the URL-safe alphabet and restores missing padding", () => {
  // 0xfb 0xff 0xfe is "+//+" in standard base64 and "-__-" in the URL-safe form.
  expect(urlBase64ToUint8Array("-__-")).toEqual(new Uint8Array([0xfb, 0xff, 0xfe]));
  expect(urlBase64ToUint8Array("AQ")).toEqual(new Uint8Array([1]));
});
