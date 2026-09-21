# Complete offline Für Elise

Beethoven, WoO 59. Public-domain score typeset by Stelios Samelis for the
Mutopia Project, source Breitkopf & Härtel (1888), revision 2015-08-18.

Source and explicit public-domain dedication:
https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=931

Original LilyPond source:
https://www.mutopiaproject.org/ftp/BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.ly

`fur-elise.ly` retains the attribution and notes. OwlBot adds `\unfoldRepeats`
and omits engraving output. The downloaded MIDI omitted written repeats, so
`fur-elise.mid` is regenerated from this source using LilyPond 2.26.0:

    lilypond -o fur-elise fur-elise.ly

The asset contains 1,041 note events over 156.24994 seconds at the source tempo
(quarter note = 72). It includes both written repeat sections and alternate
endings, both contrasting middle passages, the final return and ending/rest.
Tests pin note count, opening, later passage, final chord and full duration.

Piano mode synthesizes both staves. Humming mode follows the highest active
note of the upper staff, one octave lower, retaining the complete timeline.
It is a monophonic synthesized hum, not a sung polyphonic piano arrangement
and not a clone of the selected speaking voice. Another MIDI can be imported
locally; the renderer supports notes, tempo and sustain, not general-MIDI
instrument banks, percussion kits, pitch-bend or expressive controller curves.
Unsupported type-2/SMPTE/oversized files are rejected, never silently truncated.

No score, MIDI, microphone recording, or pitch data is uploaded for this feature.
The separate normal speech-recognition path is unchanged. Explicit Copy my
humming uses a 12-second pitch-only capture and discards the samples afterward.
