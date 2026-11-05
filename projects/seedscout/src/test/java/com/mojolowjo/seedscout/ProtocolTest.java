package com.mojolowjo.seedscout;

import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ProtocolTest {
    @Test
    void scanRequestRoundTrip() {
        JsonObject req = Protocol.scan("minecraft:overworld", 7, List.of(new int[]{1, 2}, new int[]{-3, 4}), List.of("#forge:ores", "minecraft:ancient_debris"));
        JsonObject back = Protocol.parse(req.toString());
        assertEquals("scan", Protocol.command(back));
        assertEquals("minecraft:overworld", back.get("dim").getAsString());
        assertEquals(7, back.get("q").getAsInt());
        List<int[]> chunks = Protocol.chunks(back);
        assertEquals(2, chunks.size());
        assertArrayEquals(new int[]{-3, 4}, chunks.get(1));
        assertEquals(List.of("#forge:ores", "minecraft:ancient_debris"), Protocol.strings(back, "blocks"));
    }

    @Test
    void chunkReplyRoundTrip() {
        OreStore.ChunkOres c = new OreStore.ChunkOres(2, 3, 9, List.of(new OreStore.Ore(33, -12, 50, "minecraft:iron_ore")));
        JsonObject back = Protocol.parse(Protocol.chunkReply("minecraft:the_nether", 9, c).toString());
        assertEquals("chunk", Protocol.command(back));
        assertFalse(back.has("error"));
        OreStore.ChunkOres got = Protocol.chunkOres(back);
        assertEquals(2, got.x);
        assertEquals(3, got.z);
        assertEquals(9, got.query);
        assertEquals(List.of(new OreStore.Ore(33, -12, 50, "minecraft:iron_ore")), got.ores);
    }

    @Test
    void errorReplyHasNoOres() {
        JsonObject back = Protocol.parse(Protocol.chunkError("x:y", 1, 5, 6, "no dimension").toString());
        assertTrue(back.has("error"));
        assertEquals(0, Protocol.chunkOres(back).ores.size());
    }

    @Test
    void querySignatureIgnoresOrderAndDuplicates() {
        assertEquals(Protocol.query(List.of("a", "b")), Protocol.query(List.of("b", "a", "a")));
        assertNotEquals(Protocol.query(List.of("a")), Protocol.query(List.of("a", "b")));
    }

    @Test
    void hashReplyKeepsNegativeLongs() {
        JsonObject back = Protocol.parse(Protocol.hashReply(-8161242814662636247L, -3796965907673005514L).toString());
        assertEquals(-8161242814662636247L, back.get("hash").getAsLong());
        assertEquals(-3796965907673005514L, back.get("seed").getAsLong());
    }
}
