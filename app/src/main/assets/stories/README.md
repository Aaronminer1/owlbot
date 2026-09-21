# Bedtime library — complete, attributed texts

This is a bounded starter library, not a claim to contain every classic. The
reader does not reconstruct books from model memory or turn them into summaries.
Use the local plain-text import control to add a text you have permission to use.

## Child-to-child default (7.18)

Each of the 12 stories now has a separately authored beginning-to-end retelling
bundled in `../story-library.js`: everyday words, shorter sentences,
contractions, natural dialogue and occasional gentle humor. These are adaptations,
not unabridged quotations of the source. Main events and endings are retained;
darker themes are still labeled. Original text and original record ids are unchanged.

Generic spoken requests, the initial library selection and the `read_story` tool
default to these retellings. Asking for the original/historical version, choosing
its labeled UI entry, or setting `historical:true` selects the unchanged text.
Resume stays in the exact saved edition; it never reuses an original's passage
index in a retelling. The catalog contains 24 editions of 12 stories, not 24
different stories. No per-reading rewrite/model call is needed.

Sources and edition metadata:

- Aesop / George Fyler Townsend: https://www.gutenberg.org/ebooks/21
  (seven complete fables; credit: David Widger).
- Flora Annie Steel, *English Fairy Tales* (1918):
  https://www.gutenberg.org/ebooks/17034 (Goldilocks / Three Little Pigs;
  credits: Suzanne Shell, Janet Blenkinship and Distributed Proofreaders).
- Joseph Jacobs, *English Fairy Tales* (1890):
  https://www.gutenberg.org/ebooks/7439 (The Magpie's Nest; credits: Charles
  Franks, Delphine Lettau and Distributed Proofreaders; HTML: David Widger).
- Beatrix Potter, *The Tale of Peter Rabbit* (1902):
  https://www.gutenberg.org/ebooks/14838 (credits: Robert Cicconetti, Ronald
  Holder and the Project Gutenberg Online Distributed Proofreading Team).
- Margery Williams, *The Velveteen Rabbit* (1922):
  https://www.gutenberg.org/ebooks/11757 (courtesy of the Celebration of Women
  Writers, https://digital.library.upenn.edu/women/).

These source editions are identified by Project Gutenberg as public domain in
the United States. Users elsewhere should check their jurisdiction. The source
license is included in `GUTENBERG-LICENSE.txt`. No modern translation or edition
is implied. The app does not include the illustrations.

The development library compiler selected complete stories at explicit chapter
boundaries. It removed illustration labels and print emphasis marks, normalized
line wrapping, and restores the missing decorative initial T in the source
plain-text Velveteen Rabbit. No plot passages or endings are removed. Each
entry includes a word count, SHA-256, edition, source and specific content note.

Historical does not mean gentle: the old Three Bears ending mentions a broken
neck and whipping; the Three Little Pigs includes eating and boiling; Peter
Rabbit mentions his father's death; Velveteen Rabbit includes illness and
threatened destruction. They are labeled, and are not chosen as the default
bedtime story or while the person has just expressed distress. The default is
The Hare and the Tortoise. Full historical wording can include archaic language.

Story text and checkpoints are stored on the phone. This community edition uses
device TTS, not the private neural transport. The installed Android engine's network requirement
depends on the selected engine/voice. Only one next passage is prepared ahead.
The next passage is not requested after cancellation. Already in-flight synthesis
may finish, but its late audio is discarded.

Pause/Stop/Talk/typing/background/sleep save the current unfinished sentence or
short dialogue turn (long sentences split additionally at 420 characters).
Resume is explicit and repeats that unit, not the whole passage/book, so an
interruption cannot silently skip words. No autoplay-next-story or bedtime
background model loop is added. Character voices are modest pitch/rate changes
of the owner's selected voice, not new permanent identities or loud sound effects.

## Mid-story questions (7.19)

The owner selected Talk-button-only interruption, NOT open-microphone narration.
While awake outside Settings, hold Talk to pause the audio and start capture;
release to submit. Typed questions also pause reading. Settings previews remain
audio-only and do not wake the mind. Narration keeps the microphone closed.

Each question gets a bounded scene snapshot: title, edition, up to four completed
sentences and the interrupted sentence, not future story text. It is marked as
quoted story data, not instructions or personal memory. The model is instructed
to answer briefly, avoid unrequested spoilers, accept follow-ups, and wait for
permission before resuming. Model behavior still needs real-device evaluation.
The scene context is included for the configured cloud/tower brain provider.

The reader enforces no unrequested read/restart tool call during a question.
A short yes resumes only after a matching continuation offer completed speech,
within 90 seconds. Another question clears that offer. Explicit "continue the
story" always remains available. There is no timeout-triggered automatic resume.
Scene context expires after ten minutes and clears on sleep, backgrounding,
explicit story cancellation, starting another story or completion.

Versioned bookmarks include text offsets. Old passage-index bookmarks map back
to their containing sentence, preserving the exact edition and avoiding skipped
text. A completed book does not restart merely because Resume is pressed.
