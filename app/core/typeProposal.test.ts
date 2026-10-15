import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ProposalWording, TypeProposal } from "./typeProposal.ts";

test("the first type Vocify gives the call is a proposal", () => {
  const proposal = new TypeProposal();
  assert.equal(proposal.hear(null, false), null);
  const note = proposal.hear("discovery", true);
  assert.deepEqual([note?.kind, note?.key, note?.previous], ["propose", "discovery", null]);
  assert.equal(proposal.note, note);
  assert.equal(proposal.shown, "discovery");
});

test("the same type heard again announces nothing and keeps the note on show", () => {
  const proposal = new TypeProposal();
  const first = proposal.hear("discovery", true);
  assert.equal(proposal.hear("discovery", true), null);
  assert.equal(proposal.note, first);
});

test("a later change reads as a change and remembers the type before", () => {
  const proposal = new TypeProposal();
  proposal.hear("discovery", true);
  proposal.expire();
  const note = proposal.hear("closing", true);
  assert.deepEqual([note?.kind, note?.key, note?.previous], ["change", "closing", "discovery"]);
});

test("a change while the first proposal is still on show keeps going back to the type before it", () => {
  const proposal = new TypeProposal();
  proposal.hear("discovery", true);
  const note = proposal.hear("closing", true);
  assert.equal(note?.kind, "change");
  assert.equal(note?.previous, "discovery");
});

test("each note has its own id, so the highlight plays again", () => {
  const proposal = new TypeProposal();
  const a = proposal.hear("discovery", true);
  const b = proposal.hear("closing", true);
  assert.notEqual(a?.id, b?.id);
});

test("a type the dashboard does not call a proposal is shown without a note", () => {
  const proposal = new TypeProposal();
  assert.equal(proposal.hear("discovery", false), null);
  assert.equal(proposal.shown, "discovery");
  assert.equal(proposal.note, null);
});

test("a proposal replaces a type that was not one: it reads as a change", () => {
  const proposal = new TypeProposal();
  proposal.hear("discovery", false);
  const note = proposal.hear("closing", true);
  assert.deepEqual([note?.kind, note?.previous], ["change", "discovery"]);
});

test("Undo restores the previous type, makes it the rep's and nothing is announced again", () => {
  const proposal = new TypeProposal();
  proposal.hear("discovery", true);
  proposal.hear("closing", true);
  assert.equal(proposal.undo(), "discovery");
  assert.equal(proposal.shown, "discovery");
  assert.equal(proposal.note, null);
  assert.equal(proposal.hear("proposal", true), null);
  assert.equal(proposal.shown, "proposal");
  assert.equal(proposal.note, null);
});

test("there is nothing to undo on a first proposal or once the note is gone", () => {
  const proposal = new TypeProposal();
  proposal.hear("discovery", true);
  assert.equal(proposal.undo(), null);
  proposal.hear("closing", true);
  proposal.expire();
  assert.equal(proposal.undo(), null);
  assert.equal(proposal.shown, "closing");
});

test("any pick is final, even of the type already shown", () => {
  const proposal = new TypeProposal();
  proposal.hear("discovery", true);
  proposal.pick("discovery");
  assert.equal(proposal.note, null);
  assert.equal(proposal.hear("closing", true), null);
  assert.equal(proposal.note, null);
  assert.equal(proposal.shown, "closing");
});

test("a pick ends the note on show", () => {
  const proposal = new TypeProposal();
  proposal.hear("discovery", true);
  proposal.hear("closing", true);
  proposal.pick("proposal");
  assert.equal(proposal.note, null);
  assert.equal(proposal.shown, "proposal");
});

test("handing the type back to Vocify lets it propose again", () => {
  const proposal = new TypeProposal();
  proposal.pick("discovery");
  proposal.pick(null);
  assert.equal(proposal.hear("closing", true)?.kind, "change");
});

test("a new call starts clean", () => {
  const proposal = new TypeProposal();
  proposal.hear("discovery", true);
  proposal.pick("closing");
  proposal.reset();
  assert.equal(proposal.shown, null);
  assert.equal(proposal.hear("discovery", true)?.kind, "propose");
});

test("the dashboard clearing the type clears the note", () => {
  const proposal = new TypeProposal();
  proposal.hear("discovery", true);
  proposal.hear(null, false);
  assert.equal(proposal.note, null);
  assert.equal(proposal.hear("discovery", true)?.kind, "propose");
});

test("wording in Spanish and English", () => {
  assert.equal(ProposalWording.lead("es", "propose", "Demo y cierre"), "Propone: Demo y cierre");
  assert.equal(ProposalWording.action("es", "propose"), "Cambiar");
  assert.equal(ProposalWording.lead("es", "change", "Demo y cierre"), "Cambia a Demo y cierre");
  assert.equal(ProposalWording.action("es", "change"), "Deshacer");
  assert.equal(ProposalWording.lead("en", "propose", "Demo"), "Suggests: Demo");
  assert.equal(ProposalWording.action("en", "propose"), "Change");
  assert.equal(ProposalWording.lead("en", "change", "Demo"), "Changes to Demo");
  assert.equal(ProposalWording.action("en", "change"), "Undo");
});

test("the language is the computer's: Spanish for any es locale, else English", () => {
  assert.equal(ProposalWording.language("es-ES"), "es");
  assert.equal(ProposalWording.language("es"), "es");
  assert.equal(ProposalWording.language("en-US"), "en");
  assert.equal(ProposalWording.language(""), "en");
});
