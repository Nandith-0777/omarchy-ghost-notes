import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

// Run only in the disposable nested compositor described in the plugin README.
const outputName = process.env.GHOST_NOTES_CAPTURE_OUTPUT;
const output = process.env.GHOST_NOTES_TEST_OUTPUT;
assert.ok(
  outputName?.startsWith("GN-TEST"),
  "A disposable GN-TEST output is required",
);
assert.ok(
  output?.startsWith("/tmp/"),
  "Use a disposable /tmp evidence directory",
);
fs.mkdirSync(output, { recursive: true });
const hy = (...args) =>
  execFileSync("hyprctl", args, { encoding: "utf8", timeout: 5000 });
const clients = () => JSON.parse(hy("clients", "-j"));
const mon = JSON.parse(hy("monitors", "-j")).find((m) => m.name === outputName);
assert.ok(mon);
const note = clients().find(
  (w) => w.title === "Ghost Notes Note" && w.monitor === mon.id,
);
const fixture = clients().find(
  (w) => w.title === "Public capture fixture" && w.monitor === mon.id,
);
assert.ok(note, "Put a disposable Ghost Notes window on the test output");
assert.equal(
  clients().filter(
    (w) => w.title === "Ghost Notes Note" && w.monitor === mon.id,
  ).length,
  1,
  "Use exactly one disposable note for a controlled background comparison",
);
assert.ok(
  clients().some(
    (w) => w.title === "Public capture fixture" && w.monitor === mon.id,
  ),
  "The patterned public fixture must be on the test output",
);
assert.equal(
  hy("getprop", `address:${note.address}`, "no_screen_share").trim(),
  "true",
);
const capture = (name, region) => {
  hy("dispatch", `hl.dsp.focus({window="address:${fixture.address}"})`);
  const file = path.join(output, name + ".png");
  execFileSync(
    "grim",
    [...(region ? ["-g", region] : ["-o", outputName]), file],
    { timeout: 10000 },
  );
  return file;
};
const diff = (a, b) => {
  const result = spawnSync(
    "magick",
    ["compare", "-metric", "AE", a, b, "null:"],
    { encoding: "utf8" },
  );
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  return Number.parseFloat(result.stderr);
};
const move = (workspace) =>
  hy(
    "dispatch",
    `hl.dsp.window.move({workspace=${JSON.stringify(workspace)},follow=false,window="address:${note.address}"})`,
  );
const wait = () => new Promise((r) => setTimeout(r, 250));
const statusBefore = JSON.parse(hy("ghostnotes:status", "-j"));
assert.equal(statusBefore.mode, "compositor-omit");
let unprotected, omitted, baseline, region, regionBaseline;
const geometry = `${note.at[0]},${note.at[1]} ${note.size[0]}x${note.size[1]}`;
try {
  hy("eval", "ghost_notes_privacy_rule:set_enabled(false)");
  await wait();
  assert.equal(
    hy("getprop", `address:${note.address}`, "no_screen_share").trim(),
    "false",
  );
  capture("control-warmup");
  unprotected = capture("unprotected-control");
  hy("eval", "ghost_notes_privacy_rule:set_enabled(true)");
  await wait();
  assert.equal(
    hy("getprop", `address:${note.address}`, "no_screen_share").trim(),
    "true",
  );
  capture("protected-warmup");
  omitted = capture("protected-omission");
  region = capture("protected-region", geometry);
  hy(
    "dispatch",
    `hl.dsp.window.pin({action="disable",window="address:${note.address}"})`,
  );
  move("special:ghost-notes-capture-validation");
  await wait();
  assert.ok(
    clients()
      .find((w) => w.address === note.address)
      .workspace.name.startsWith("special:"),
  );
  baseline = capture("background-only");
  regionBaseline = capture("background-region", geometry);
} finally {
  hy("eval", "ghost_notes_privacy_rule:set_enabled(true)");
  move(String(note.workspace.id));
  if (note.pinned)
    hy(
      "dispatch",
      `hl.dsp.window.pin({action="enable",window="address:${note.address}"})`,
    );
}
const protectedDifference = diff(omitted, baseline);
const regionDifference = diff(region, regionBaseline);
const controlDifference = diff(unprotected, baseline);
assert.equal(
  protectedDifference,
  0,
  "Protected capture must match the actual background pixel for pixel",
);
assert.equal(
  regionDifference,
  0,
  "Region capture must match the background pixel for pixel",
);
assert.ok(
  controlDifference > 1000,
  "Control must prove the note was actually visible",
);
const statusAfter = JSON.parse(hy("ghostnotes:status", "-j"));
assert.ok(statusAfter.frames > statusBefore.frames);
const result = {
  testedAt: new Date().toISOString(),
  monitor: mon,
  protectedDifference,
  regionDifference,
  controlDifference,
  frames: statusAfter.frames - statusBefore.frames,
  hash: statusAfter.hash,
};
fs.writeFileSync(
  path.join(output, "results.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
