import test from "node:test";
import assert from "node:assert/strict";
import { checkPunch, distanceM, farText, nearestSite, readPoint, readSite, selfieType } from "../src/clockin-rules.js";

const office = { id: 1, name: "Mumbai office", lat: 19.0760, lng: 72.8777, radius: 150 };
const on = { enabled: true, needLocation: true, needSelfie: false, allowOutside: false };

test("distance: zero at the same point, about 1.11 km for 0.01 degree of latitude", () => {
  assert.equal(distanceM(office, office), 0);
  const d = distanceM(office, { lat: 19.0860, lng: 72.8777 });
  assert.ok(d > 1100 && d < 1120, String(d));
  assert.equal(farText(40), "40 m"); assert.equal(farText(2345), "2.3 km"); assert.equal(farText(23456), "23 km");
});
test("point: none sent, a good one, and nonsense", () => {
  assert.deepEqual(readPoint({}), { point: null, error: "" });
  assert.deepEqual(readPoint({ lat: 19.0760001234, lng: 72.8777, accuracy: 12.4 }).point, { lat: 19.076, lng: 72.8777, accuracy: 12 });
  assert.ok(readPoint({ lat: 120, lng: 72 }).error);
  assert.ok(readPoint({ lat: "x", lng: 72 }).error);
});
test("office: name, position and a radius from 30 to 5,000 m", () => {
  assert.deepEqual(readSite({ name: "HQ", lat: 19, lng: 72, radius: 150 }).errors, {});
  const e = readSite({ radius: 10 }).errors;
  assert.ok(e.name && e.lat && e.lng && e.radius);
});
test("punch: inside the office is matched to it", () => {
  const r = checkPunch(on, [office], { lat: 19.0765, lng: 72.8777, accuracy: 20 }, false);
  assert.equal(r.ok, true); assert.equal(r.siteId, 1); assert.equal(r.outside, false); assert.ok(r.distance < 150);
});
test("punch: outside every office is refused, or kept and flagged when HR allows it", () => {
  const far = { lat: 19.2, lng: 72.9, accuracy: 20 };
  const no = checkPunch(on, [office], far, false);
  assert.equal(no.ok, false); assert.match(no.error, /km from Mumbai office/);
  const yes = checkPunch({ ...on, allowOutside: true }, [office], far, false);
  assert.equal(yes.ok, true); assert.equal(yes.outside, true);
});
test("punch: location, precision and selfie when asked", () => {
  assert.match(checkPunch(on, [office], null, false).error, /allow location/);
  assert.match(checkPunch(on, [office], { lat: 19.0760, lng: 72.8777, accuracy: 5000 }, false).error, /not precise/);
  assert.match(checkPunch({ ...on, needSelfie: true }, [office], { lat: 19.0760, lng: 72.8777, accuracy: 5 }, false).error, /selfie/);
  assert.equal(checkPunch({ ...on, needLocation: false }, [office], null, false).ok, true, "location not asked: fine without it");
  assert.equal(checkPunch(on, [], { lat: 1, lng: 1, accuracy: 5 }, false).ok, true, "no offices listed: the location is only recorded");
});
test("nearest office of several", () => {
  const pune = { id: 2, name: "Pune office", lat: 18.5204, lng: 73.8567, radius: 200 };
  assert.equal(nearestSite([office, pune], { lat: 18.521, lng: 73.857 }).site.id, 2);
});
test("selfie: only JPEG or WebP, by the first bytes", () => {
  assert.equal(selfieType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])).mime, "image/jpeg");
  assert.equal(selfieType(Buffer.from("RIFF0000WEBPVP8 ")).mime, "image/webp");
  assert.equal(selfieType(Buffer.from("<svg onload=alert(1)></svg>")), null);
  assert.equal(selfieType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), null, "PNG is not accepted");
});
