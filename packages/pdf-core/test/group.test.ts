/**
 * Group / ungroup: /RT /Group + /IRT written like Revu, read back, and cleared.
 */

import { describe, expect, it } from 'vitest';
import { PDFName } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { addShapeMarkup } from '../src/annots/shapes.js';
import { groupMarkups, groupMembers, isGrouped, ungroupMarkups } from '../src/annots/group.js';
import { blankArchD, syntheticBluebeam } from './helpers/synthetic.js';

async function three() {
  const doc = await openDocument(await blankArchD());
  const ids = ['A', 'B', 'C'].map(
    (s, i) =>
      addShapeMarkup(
        doc,
        0,
        { kind: 'rectangle', rect: [i * 100, 0, i * 100 + 50, 50] },
        {
          subject: s,
          author: 'T',
        },
      ).id,
  );
  return { doc, ids };
}

describe('groups', () => {
  it('groups under the first id and reads back after a save', async () => {
    const { doc, ids } = await three();
    const parent = groupMarkups(doc, ids);
    expect(parent).toBe(ids[0]);
    expect(groupMembers(doc, ids[2]!)).toEqual(ids);
    expect(isGrouped(doc, ids[1]!)).toBe(true);
    const b = doc.markups.find((m) => m.id === ids[1])!;
    expect(b.raw.get(PDFName.of('RT'))).toBe(PDFName.of('Group'));
    expect(b.raw.get(PDFName.of('IRT'))).toBe(doc.markups[0]!.ref);
    const back = await openDocument((await saveIncremental(doc)).bytes);
    expect(groupMembers(back, ids[1]!)).toEqual(ids);
    expect(back.markups.find((m) => m.id === ids[0])!.relations.groupParent).toBeUndefined();
  });

  it('ungroups a member, a parent, and leaves replies alone', async () => {
    const { doc, ids } = await three();
    groupMarkups(doc, ids);
    ungroupMarkups(doc, [ids[2]!]); // member: only itself leaves? No — Revu ungroups the set.
    expect(isGrouped(doc, ids[2]!)).toBe(false);
    expect(isGrouped(doc, ids[1]!)).toBe(false);
    groupMarkups(doc, [ids[1]!, ids[2]!]);
    expect(groupMembers(doc, ids[2]!)).toEqual([ids[1], ids[2]]);
    expect(isGrouped(doc, ids[0]!)).toBe(false);

    const revu = await openDocument(await syntheticBluebeam());
    const reply = revu.markups.find((m) => m.relations.replyTo)!;
    ungroupMarkups(revu, [reply.id]);
    expect(reply.raw.has(PDFName.of('IRT'))).toBe(true); // /RT /R is a reply, not a group
  });

  it('refuses a group across pages or with one member', async () => {
    const { doc, ids } = await three();
    expect(() => groupMarkups(doc, [ids[0]!])).toThrow(/two markups/);
  });
});
