package com.mojolowjo.dataexport;

/** The hashed-seed text forms (seed.json). Pure Java, unit tested. */
public final class Seeds {
    private Seeds() {}

    /** The 64-bit value as 0x and 16 hex digits, two's complement for negatives. */
    public static String hex(long v) {
        String h = Long.toHexString(v);
        return "0x" + "0".repeat(16 - h.length()) + h;
    }
}
