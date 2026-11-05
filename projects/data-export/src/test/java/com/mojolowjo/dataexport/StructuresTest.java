package com.mojolowjo.dataexport;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class StructuresTest {
    @Test
    void randomSpreadSummaryNamesTheNumbersAndTheStructures() {
        JsonObject s = Structures.summary(JsonParser.parseString("{\"placement\":{\"type\":\"minecraft:random_spread\",\"salt\":14357617,"
                + "\"spacing\":32,\"separation\":8,\"spread_type\":\"triangular\",\"frequency\":0.5,\"frequency_reduction_method\":\"legacy_type_1\","
                + "\"exclusion_zone\":{\"other_set\":\"minecraft:villages\",\"chunk_count\":10}},"
                + "\"structures\":[{\"structure\":\"minecraft:pillager_outpost\",\"weight\":1},{\"structure\":{\"type\":\"x\"},\"weight\":1}]}"));
        assertEquals("random_spread", s.get("placement").getAsString());
        assertFalse(s.has("placement_type"));
        assertEquals(32, s.get("spacing").getAsInt());
        assertEquals(8, s.get("separation").getAsInt());
        assertEquals(14357617, s.get("salt").getAsInt());
        assertEquals("triangular", s.get("spread_type").getAsString());
        assertEquals(0.5, s.get("frequency").getAsDouble());
        assertEquals("legacy_type_1", s.get("frequency_reduction_method").getAsString());
        assertEquals("minecraft:villages", s.getAsJsonObject("exclusion_zone").get("other_set").getAsString());
        assertEquals("[\"minecraft:pillager_outpost\",\"<inline structure>\"]", s.get("structures").toString());
    }

    @Test
    void concentricRingsKeepTheirOwnNumbers() {
        JsonObject s = Structures.summary(JsonParser.parseString("{\"placement\":{\"type\":\"minecraft:concentric_rings\",\"salt\":0,"
                + "\"distance\":32,\"spread\":3,\"count\":128,\"preferred_biomes\":\"#minecraft:stronghold_biased_to\"},\"structures\":[{\"structure\":\"minecraft:stronghold\",\"weight\":1}]}"));
        assertEquals("concentric_rings", s.get("placement").getAsString());
        assertEquals(128, s.get("count").getAsInt());
        assertEquals(3, s.get("spread").getAsInt());
        assertFalse(s.has("spacing"), "a field the JSON does not carry is left out");
    }

    @Test
    void anUnknownPlacementSaysOtherWithItsType() {
        JsonObject s = Structures.summary(JsonParser.parseString("{\"placement\":{\"type\":\"somemod:grid\",\"salt\":5},\"structures\":[]}"));
        assertEquals("other", s.get("placement").getAsString());
        assertEquals("somemod:grid", s.get("placement_type").getAsString());
        assertEquals(0, s.getAsJsonArray("structures").size());
    }

    @Test
    void aBrokenFileYieldsANoteNotAnException() {
        assertEquals("not a JSON object", Structures.summary(JsonParser.parseString("[1,2]")).get("note").getAsString());
        assertEquals("no placement object", Structures.summary(JsonParser.parseString("{\"structures\":[]}")).get("note").getAsString());
    }

    @Test
    void structureSetAndStructurePathsDoNotCrossMatch() {
        assertEquals("minecraft:villages", Names.idFromDataPath("data/minecraft/worldgen/structure_set/villages.json", "worldgen/structure_set"));
        assertNull(Names.idFromDataPath("data/minecraft/worldgen/structure_set/villages.json", "worldgen/structure"));
        assertEquals("minecraft:village_plains", Names.idFromDataPath("data/minecraft/worldgen/structure/village_plains.json", "worldgen/structure"));
        assertNull(Names.idFromDataPath("data/minecraft/worldgen/structure/village_plains.json", "worldgen/structure_set"));
        assertEquals("worldgen/structure_set", Exporter.kindOf("data/ctov/worldgen/structure_set/villages.json"));
        assertEquals("worldgen/structure", Exporter.kindOf("data/ctov/worldgen/structure/village_plains.json"));
    }

    @Test
    void hashedSeedHexIsSixteenDigits() {
        assertEquals("0x0000000000000001", Seeds.hex(1L));
        assertEquals("0xffffffffffffffff", Seeds.hex(-1L));
        assertEquals("0x8000000000000000", Seeds.hex(Long.MIN_VALUE));
    }
}
