package dev.owlbot.brain;

import java.util.ArrayDeque;

/** Bounded in-memory PCM backlog. Never persists recordings or retries a
 * retired microphone session. The Android main thread owns this queue. */
final class SpeechCaptureQueue {
    static final int CAPACITY = 3;
    static final int MAX_BYTES = 16000 * 2 * 13; // 12-second utterance + pre-roll
    static final class Clip {
        final byte[] pcm;
        final int rate;
        final String key;
        final long capture;
        Clip(byte[] pcm, int rate, String key, long capture) {
            this.pcm = pcm; this.rate = rate; this.key = key; this.capture = capture;
        }
    }
    private final ArrayDeque<Clip> clips = new ArrayDeque<>();
    boolean offer(Clip clip) {
        if (clip.pcm.length == 0 || clip.pcm.length > MAX_BYTES || clips.size() >= CAPACITY) return false;
        clips.addLast(clip); return true;
    }
    Clip poll(long capture) {
        while (!clips.isEmpty()) {
            Clip clip = clips.removeFirst();
            if (clip.capture == capture) return clip;
        }
        return null;
    }
    int size() { return clips.size(); }
    void clear() { clips.clear(); }
}
