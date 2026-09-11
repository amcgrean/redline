# Interop checklist (manual, run by Aaron after each pdf-core milestone)

Open every file in `fixtures/out/` in **Bluebeam Revu 21**, **Acrobat**, **Chrome**, and **Edge**. Record pass/fail per row and paste the table (plus screenshots of Revu's Markups List) into the PR.

| #   | Check                                                                                 | Revu | Acrobat | Chrome | Edge |
| --- | ------------------------------------------------------------------------------------- | ---- | ------- | ------ | ---- |
| 1   | File opens without a repair prompt or error                                           |      |         |        |      |
| 2   | Every Redline markup is visible at the right position and size                        |      |         |        |      |
| 3   | Line endings, dashes, fill opacity, and clouds render as drawn                        |      |         |        |      |
| 4   | Measurement captions show the same value Redline showed                               |      |         |        |      |
| 5   | Revu Markups List shows Subject, Author, Date, Length/Area/Count for each measurement |      | —       | —      | —    |
| 6   | Revu's page scale (Measurements panel) matches Redline's calibration                  |      | —       | —      | —    |
| 7   | Acrobat "Use scale and units from document" picks up the scale                        | —    |         | —      | —    |
| 8   | Measurements are editable in Revu (move a vertex; length updates)                     |      | —       | —      | —    |
| 9   | Stamps appear as Stamp markups (Revu: editable color/opacity/rotation)                |      |         |        |      |
| 9a  | `stamps-0.5-revu.pdf`: APPROVED text stamp, rotated 60% vector stamp, RECEIVED on every page; all listed as Stamp in Revu's Markups List and movable |      |         |        |      |
| 10  | Text boxes, callouts, and notes show correct text, font size, alignment               |      |         |        |      |
| 11  | Page reorder/rotate/delete/merge results are correct and bookmarks survived           |      |         |        |      |
| 11a | `pages-0.4-revu-rotated-reordered.pdf`: page 1 rotated 90°, last page moved first; Revu Markups List values unchanged, custom columns/spaces intact |      |         |        |      |
| 11b | `pages-0.4-revu-deleted.pdf`: page 2 removed; remaining markups intact, no orphan rows in the Markups List |      |         |        |      |
| 12  | Print preview shows markups (`/F 4`)                                                  |      |         |        |      |

## Round-trip (Revu-authored fixtures edited in Redline)

| #   | Check                                                                                                           | Result |
| --- | --------------------------------------------------------------------------------------------------------------- | ------ |
| R1  | Custom columns still present with values (Revu Markups List → custom columns)                                   |        |
| R2  | Spaces intact (Revu Spaces panel)                                                                               |        |
| R3  | Groups and replies intact                                                                                       |        |
| R4  | Layers intact and toggling still hides/shows the right markups                                                  |        |
| R5  | Page scale unchanged unless Redline changed it                                                                  |        |
| R6  | Dynamic stamp still present with its baked values                                                               |        |
| R7  | Edit one markup in Revu, save, reopen in Redline: Redline shows the change, saves, reopen in Revu: nothing lost |        |
| R8  | Automated: `pnpm test:corpus` dictionary diff touched only owned keys                                           |        |

## Compression

| #   | Check                                                                                     | Result |
| --- | ----------------------------------------------------------------------------------------- | ------ |
| C1  | Optimize: file opens everywhere, markups intact, size reduced                             |        |
| C1a | `compress-0.6-revu-optimized.pdf`: opens in Revu with every markup, custom column and space intact; size shown in the script output |        |
| C2  | Reduce images: text still legible at 100%, vectors untouched, size reduced ≥ 60% on scans |        |
