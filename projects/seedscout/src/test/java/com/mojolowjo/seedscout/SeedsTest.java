package com.mojolowjo.seedscout;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SeedsTest {
    /** The owner's server: seed -3796965907673005514 must hash to -8161242814662636247 (BiomeManager.obfuscateSeed). */
    @Test
    void ownersSeedHashesToTheExpectedValue() {
        assertEquals(-8161242814662636247L, Seeds.obfuscate(-3796965907673005514L));
    }

    @Test
    void zeroSeedMatchesGuavaSha256HashLong() {
        // sha256 of eight zero bytes starts af 55 70 f5 a1 81 0b 7a ..., read little-endian
        assertEquals(8794265229978523055L, Seeds.obfuscate(0L));
    }

    @Test
    void parseReadsNumbersAndHashesText() {
        assertEquals(-3796965907673005514L, Seeds.parse(" -3796965907673005514 "));
        assertEquals("hello".hashCode(), Seeds.parse("hello"));
    }
}
