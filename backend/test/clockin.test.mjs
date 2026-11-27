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

/* ---------- office internet (optional) and the fingerprint or face check ---------- */
import { confirmNeeded, networkOf, onNetwork, readNetwork } from "../src/clockin-rules.js";
test("office internet: addresses and ranges, IPv4 and IPv6, tidied or refused", () => {
  assert.equal(readNetwork(" 203.0.113.7 "), "203.0.113.7");
  assert.equal(readNetwork("203.0.113.0/24"), "203.0.113.0/24");
  assert.equal(readNetwork("2001:DB8:1:2::/64"), "2001:db8:1:2::/64");
  assert.equal(readNetwork("::ffff:203.0.113.7"), "203.0.113.7");
  for (const bad of ["", "office wifi", "203.0.113.0/8", "203.0.113.0/33", "1.2.3.4/24/1", "2001:db8::/16"]) assert.equal(readNetwork(bad), null, bad);
  assert.equal(networkOf("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(networkOf("2001:db8:1:2:aa:bb:cc:dd"), "2001:db8:1:2::/64", "a phone's IPv6 changes inside its /64");
  assert.equal(onNetwork("203.0.113.99", ["203.0.113.0/24"]), true);
  assert.equal(onNetwork("::ffff:203.0.113.7", ["203.0.113.7"]), true);
  assert.equal(onNetwork("2001:db8:1:2::9", ["2001:db8:1:2::/64"]), true);
  assert.equal(onNetwork("198.51.100.1", ["203.0.113.0/24"]), false);
  assert.equal(onNetwork("203.0.113.7", []), false);
});
test("office: internet addresses are optional; bad ones are named", () => {
  const base = { name: "HQ", lat: 19, lng: 72, radius: 150 };
  assert.deepEqual(readSite(base).value.networks, []);
  assert.deepEqual(readSite({ ...base, networks: "203.0.113.7\n203.0.113.7, 2001:db8::/48" }).value.networks, ["203.0.113.7", "2001:db8::/48"]);
  assert.ok(readSite({ ...base, networks: "office wifi" }).errors.networks);
});
test("punch: from the office internet needs no location and is matched to that office", () => {
  const wired = { ...office, networks: ["203.0.113.0/24"] };
  const r = checkPunch(on, [wired], null, "203.0.113.20");
  assert.equal(r.ok, true); assert.equal(r.siteId, 1); assert.equal(r.via, "network"); assert.equal(r.outside, false);
  assert.match(checkPunch(on, [wired], null, "198.51.100.1").error, /allow location/, "another network: location as before");
  assert.equal(checkPunch(on, [office], { lat: 19.0765, lng: 72.8777, accuracy: 20 }, "203.0.113.20").via, "location", "no addresses listed: location only");
});
test("fingerprint or face: off, optional (only those who set it up), required (everyone)", () => {
  assert.equal(readPolicy({}).confirm, "off");
  assert.equal(readPolicy({ confirm: "required" }).confirm, "required");
  assert.equal(readPolicy({ confirm: "always" }).confirm, "off");
  assert.equal(confirmNeeded("off", true), "no");
  assert.equal(confirmNeeded("optional", false), "no");
  assert.equal(confirmNeeded("optional", true), "yes");
  assert.equal(confirmNeeded("required", false), "setup");
  assert.equal(confirmNeeded("required", true), "yes");
});
