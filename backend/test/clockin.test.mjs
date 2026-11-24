import test from "node:test";
import assert from "node:assert/strict";
import { checkPunch, distanceM, farText, nearestSite, readPoint, readPolicy, readSite } from "../src/clockin-rules.js";

const office = { id: 1, name: "Mumbai office", lat: 19.0760, lng: 72.8777, radius: 150 };
const on = { enabled: true, needLocation: true, allowOutside: false };

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
  const r = checkPunch(on, [office], { lat: 19.0765, lng: 72.8777, accuracy: 20 });
  assert.equal(r.ok, true); assert.equal(r.siteId, 1); assert.equal(r.outside, false); assert.ok(r.distance < 150);
});
test("punch: outside every office is refused, or kept and flagged when HR allows it", () => {
  const far = { lat: 19.2, lng: 72.9, accuracy: 20 };
  const no = checkPunch(on, [office], far);
  assert.equal(no.ok, false); assert.match(no.error, /km from Mumbai office/);
  const yes = checkPunch({ ...on, allowOutside: true }, [office], far);
  assert.equal(yes.ok, true); assert.equal(yes.outside, true);
});
test("punch: location and precision when asked; never a selfie", () => {
  assert.match(checkPunch(on, [office], null).error, /allow location/);
  assert.match(checkPunch(on, [office], { lat: 19.0760, lng: 72.8777, accuracy: 5000 }).error, /not precise/);
  assert.equal(checkPunch({ ...on, needLocation: false }, [office], null).ok, true, "location not asked: fine without it");
  assert.equal(checkPunch(on, [], { lat: 1, lng: 1, accuracy: 5 }).ok, true, "no offices listed: the location is only recorded");
  assert.ok(!("needSelfie" in readPolicy({ enabled: true, needSelfie: true })), "a selfie setting is ignored");
  assert.equal(checkPunch({ ...on, needSelfie: true }, [office], { lat: 19.0760, lng: 72.8777, accuracy: 5 }).ok, true, "a stray selfie setting never blocks a punch");
});
test("nearest office of several", () => {
  const pune = { id: 2, name: "Pune office", lat: 18.5204, lng: 73.8567, radius: 200 };
  assert.equal(nearestSite([office, pune], { lat: 18.521, lng: 73.857 }).site.id, 2);
});
