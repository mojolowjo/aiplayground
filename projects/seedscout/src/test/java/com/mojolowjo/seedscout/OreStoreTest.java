package com.mojolowjo.seedscout;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class OreStoreTest {
    private static OreStore sample() {
        OreStore s = new OreStore(-3796965907673005514L, "mce:dwarven_depths");
        s.put(new OreStore.ChunkOres(3, -7, 42, List.of(
                new OreStore.Ore(3 * 16 + 5, -40, -7 * 16 + 15, "irons_spellbooks:deepslate_mithril_ore"),
                new OreStore.Ore(3 * 16 + 0, 200, -7 * 16 + 0, "minecraft:ancient_debris"))));
        s.put(new OreStore.ChunkOres(-1, -1, 42, List.of()));
        return s;
    }

    @Test
    void roundTripKeepsPositionsIdsAndQuery() throws Exception {
        OreStore s = sample();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        s.write(bytes);
        OreStore back = OreStore.read(new ByteArrayInputStream(bytes.toByteArray()));
        assertEquals(s.seed(), back.seed());
        assertEquals("mce:dwarven_depths", back.dimension());
        assertEquals(2, back.chunkCount());
        OreStore.ChunkOres c = back.get(3, -7);
        assertNotNull(c);
        assertEquals(42, c.query);
        assertEquals(2, c.ores.size());
        assertEquals(new OreStore.Ore(53, -40, -97, "irons_spellbooks:deepslate_mithril_ore"), c.ores.get(0));
        assertEquals(new OreStore.Ore(48, 200, -112, "minecraft:ancient_debris"), c.ores.get(1));
        assertTrue(back.has(-1, -1, 42));
        assertFalse(back.has(-1, -1, 43), "another block list means not cached");
        assertFalse(back.dirty());
    }

    @Test
    void negativeChunkKeysDoNotCollide() {
        assertNotEquals(OreStore.key(-1, 0), OreStore.key(0, -1));
        assertNotEquals(OreStore.key(1, -1), OreStore.key(-1, 1));
    }

    @Test
    void saveAndLoadUseOneFilePerDimension(@TempDir Path dir) throws Exception {
        OreStore s = sample();
        s.save(dir);
        Path f = OreStore.file(dir, s.seed(), "mce:dwarven_depths");
        assertTrue(Files.isRegularFile(f));
        assertEquals("mce.dwarven_depths.bin", f.getFileName().toString());
        assertEquals("-3796965907673005514", f.getParent().getFileName().toString());
        OreStore back = OreStore.load(dir, s.seed(), "mce:dwarven_depths");
        assertEquals(2, back.oreCount());
        assertEquals(0, OreStore.load(dir, 1L, "minecraft:overworld").chunkCount(), "unknown seed starts empty");
    }

    @Test
    void sizeStaysCompact() throws Exception {
        OreStore s = new OreStore(1, "minecraft:overworld");
        for (int c = 0; c < 100; c++) {
            java.util.ArrayList<OreStore.Ore> ores = new java.util.ArrayList<>();
            for (int i = 0; i < 50; i++) ores.add(new OreStore.Ore(c * 16 + i % 16, i - 60, i % 7, i % 2 == 0 ? "minecraft:iron_ore" : "minecraft:coal_ore"));
            s.put(new OreStore.ChunkOres(c, 0, 1, ores));
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        s.write(bytes);
        assertTrue(bytes.size() < 5000 * 6, "5000 ores in " + bytes.size() + " bytes");
    }
}
