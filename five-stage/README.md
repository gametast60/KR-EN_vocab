# 5 Stage MVP 6.1

Grammar MVP is available from the subject switch. See [the grammar content guide](../grammar/README.md) for the 12 pilot objectives, separate lesson/question JSON files, source inventory, SRS policy, game adapter, and update workflow. Grammar progress is stored and backed up alongside vocabulary under a separately versioned `grammar` field. Run `node tools/build-grammar.cjs --check` when verifying source changes.

Mobile-first static application for Korean and English vocabulary. The four tabs are Today, Library, Progress and Settings. The original six vocabulary files and VocabularyStudio remain the source content; images are optional.

## Run and verify

Serve the project over HTTP rather than opening `index.html` as a file:

```sh
node tools/serve.cjs
node --test tests/*.test.cjs
node tools/check-vocabulary.cjs
```

Local preview: `http://127.0.0.1:8787`. For an installed mobile app, deploy the static files to the existing HTTPS origin so its browser storage is retained. This change does not publish a site or add a backend. Offline operation becomes available after the service worker finishes its first installation; speech availability depends on installed device voices.

Browser integration tests use Playwright and Microsoft Edge with an isolated temporary profile:

```sh
node tests/mobile-browser.cjs
```

Install/provide Playwright outside the application or put its package directory on `NODE_PATH`. Set `BROWSER_CHANNEL=chrome` to use Chrome. Test screenshots/backups go to the system temporary `five-stage-mobile-qa` directory (override with `FIVE_STAGE_TEST_OUTPUT`). No browser testing dependency ships to users.

## Structure

- `scheduler.js`: pure lexical scoring, context scheduling and subsequent-recall statistics.
- `store.js`: validated storage, legacy migration, transactional writes, backup/restore.
- `session.js`: resumable task queue, conditional repair, assessment invalidation.
- `audio.js`: cancellable sequential native speech.
- `app.js` and `app.css`: mobile-first UI, catalog overlays and application workflows.
- `../visual/visual-engine.js`: vocabulary-first card construction and parenthesis-insensitive answer checking.

## MVP review policy

An independent first typed response earns 60 points. A previous qualifying correct recall on a different day adds 20. At least 24 hours since the latest answer exposure adds 10; at least seven days adds 20 instead. Scores 60–79 advance one box, 80–99 two, and 100 three (maximum box 5). Destination intervals are 1, 3, 7, 14 and 30 local-calendar days. Wrong/revealed assessed answers return to box 1. Unknown legacy history receives no invented bonus.

The 24-hour gate uses elapsed timestamps, not crossing midnight. A recent exposure, same-day repetition, skipped question, invalidated question, early practice or listening exercise cannot fast-track a word. Initially learned words may enter box 1. Viewing a word in the library/details or a summary counts as exposure. Due words waiting for that spacing are explained on Today rather than repeatedly offered as fresh assessments.

Context/form review has its own step and date. It never demotes the lexical box. A word gets one independent assessment objective per round. Later related exercises are practice. Learning stages and retries cannot overwrite a first failure. Incorrect questions can be reported/edited while feedback is open: the current assessed outcome is invalidated and its box change is reversed, preserving earlier history.

These are experimental product rules, not validated predictions of retention. Progress shows subsequent cold-recall outcomes grouped by the previous box jump. Long-term usefulness still needs real usage covering the 30-day schedule.

## Data and recovery

All application state is stored under `five_stage_mvp_v1` in the current browser/origin. A single write includes the event and resulting schedule, and failed writes do not update the in-memory state. Revision checks reject stale-tab writes. Use one active learning tab; there is no cloud/multi-device synchronization.

On first load, legacy `topik_srs_<level>_v1` boxes/dates, wrong-word lists and staged vocabulary edits migrate without deleting old keys. Future box-5 borrowing is retired. Invalid legacy entries are reported and their original storage remains available for raw backup. No personal browser data is touched by repository tests.

Backups contain settings, progress/history, pending exports, local vocabulary overrides and the resumable session/draft. Existing backup formats through version 3 are supported. Restore previews before replacement; optionally shift due dates relative to the backup date. A corrupt primary store offers raw backup and validated recovery instead of silently resetting progress. The format does not embed image binaries; custom image IDs must refer to images deployed with the app.

Local editing retains a stable word/sense ID even if spelling changes. It never merges words by stripped parentheses or shared image ID. New meanings that represent different senses should be added as new entries. Editing applies locally immediately; JSON exports are available by level or all levels, with original values for reviewing changes. Clearing the export queue does not erase the local overrides. Source sync refreshes derived content and reports orphaned histories without automatically deleting them. Users can select orphaned histories for removal after backup and a separate confirmation; invalid source rows are excluded from that cleanup.

## Content readiness

There are 7,653 source rows at this revision; 7,649 valid unambiguous entries are playable. Existing source issues are reported rather than guessed: the two duplicate `number` rows in A1, one empty A1 row, and an invalid `operation` row in B1. All 2,665 TOPIK 2 entries are now accessible without images. Sentence exercises still require a reviewed answer span; missing images/sentences never lower lexical scores.

## Mobile interaction

Bottom navigation is hidden during study; inputs retain drafts on pause/reload. Korean composition Enter does not submit an incomplete syllable. Correct feedback may advance after speech plus 1.5 seconds; incorrect feedback waits for the user. Audio and auto-advance can be disabled. Controls remain usable when native speech is missing. Dialogs use the native modal focus trap; layouts include safe-area padding and reduced-motion support.
