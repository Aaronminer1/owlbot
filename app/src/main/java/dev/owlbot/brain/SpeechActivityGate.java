package dev.owlbot.brain;

/** Local energy gate only; this class neither records nor transmits audio. */
final class SpeechActivityGate {
    private double noiseFloor = .002;
    private final double[] ambient = new double[100];
    private int ambientCount, ambientIndex, ambientFrames;

    /** Track the quiet portion of two seconds of audio, including during an
     * utterance. A noise onset must not freeze its own detection threshold. */
    void observeAmbient(double rms) {
        if (!Double.isFinite(rms) || rms < 0) return;
        ambient[ambientIndex] = rms;
        ambientIndex = (ambientIndex + 1) % ambient.length;
        ambientCount = Math.min(ambient.length, ambientCount + 1);
        if (++ambientFrames % 10 != 0 || ambientCount < 30) return;
        double[] sorted = java.util.Arrays.copyOf(ambient, ambientCount);
        java.util.Arrays.sort(sorted);
        double quiet = sorted[(ambientCount - 1) / 4];
        noiseFloor += (quiet - noiseFloor) * .2;
        noiseFloor = Math.max(.0005, Math.min(.04, noiseFloor));
    }

    static int updateSilenceFrames(int silence, boolean voice) {
        // An isolated click must not restart a full second of silence.
        return voice ? Math.max(0, silence - 3) : silence + 1;
    }

    double threshold(boolean inUtterance) {
        double onset = Math.max(.008, Math.max(noiseFloor * 2.2, noiseFloor + .005));
        return inUtterance ? onset * .70 : onset;
    }

    boolean isVoice(double rms, boolean inUtterance) {
        return Double.isFinite(rms) && rms > threshold(inUtterance);
    }

    void observeNoise(double rms) {
        if (!Double.isFinite(rms) || rms < 0) return;
        // Only non-speech frames train the floor; speech cannot teach the gate
        // to reject the next quiet phrase. Hysteresis retains softer syllables.
        noiseFloor += (rms - noiseFloor) * (rms < noiseFloor ? .08 : .01);
        noiseFloor = Math.max(.0005, Math.min(.04, noiseFloor));
    }
}
