package com.mojolowjo.seedscout;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * The hashed seed, pure Java. Vanilla's {@code BiomeManager.obfuscateSeed(seed)} is Guava's
 * {@code Hashing.sha256().hashLong(seed).asLong()}: sha256 over the seed's eight little-endian bytes,
 * the first eight digest bytes read back little-endian. Reimplemented here so it is unit tested and
 * usable without Minecraft classes.
 */
public final class Seeds {
    private Seeds() {}

    public static long obfuscate(long seed) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            byte[] digest = sha.digest(ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(seed).array());
            return ByteBuffer.wrap(digest, 0, 8).order(ByteOrder.LITTLE_ENDIAN).getLong();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Parses a seed the way the client does: a number, or any other text hashed like a world name. */
    public static long parse(String text) {
        String t = text.trim();
        try {
            return Long.parseLong(t);
        } catch (NumberFormatException e) {
            return t.hashCode();
        }
    }
}
