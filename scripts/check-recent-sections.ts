import assert from "node:assert/strict";
import {normalizeRecentSections,recordRecentSection} from "../app/ernestoRecentSections";

const now=Date.now();
const example=[
  {section:"recipes",visitedAt:now-10000},
  {section:"chat",visitedAt:now-30000},
  {section:"commercial",visitedAt:now-20000},
  {section:"recipes",visitedAt:now-1000},
  {section:"carnet",visitedAt:now-40000},
];
const normalized=normalizeRecentSections(example);
assert.deepEqual(normalized.map(item=>item.section),["recipes","commercial","chat","carnet"],"Four most recent distinct sections, sorted by last access");
assert.equal(normalized[0].visitedAt,now-1000,"Latest visit wins even when input is out of order");
assert.equal(normalizeRecentSections({not:"an array"}).length,0);
assert.equal(normalizeRecentSections([null,{section:"unsupported",visitedAt:now},{section:"chat",visitedAt:NaN},{section:"chat",visitedAt:now+3600000}]).length,0,"Discard invalid or future timestamps");
let recent=recordRecentSection([], "recipes", now-2000);
recent=recordRecentSection(recent,"chat",now-1000);
recent=recordRecentSection(recent,"commercial",now);
assert.deepEqual(recent.map(item=>item.section),["commercial","chat","recipes"]);
recent=recordRecentSection(recent,"recipes",now+1000);
assert.deepEqual(recent.map(item=>item.section),["recipes","commercial","chat"],"Reopening updates position and does not duplicate");
assert.equal(recent.length,3);
recent=recordRecentSection(recent,"carnet",now+2000);
assert.deepEqual(recent.map(item=>item.section),["carnet","recipes","commercial","chat"]);
assert.ok(recent.length<=4);
console.log("Ernesto recent sections: ordering, deduplication, validation and limit OK");
