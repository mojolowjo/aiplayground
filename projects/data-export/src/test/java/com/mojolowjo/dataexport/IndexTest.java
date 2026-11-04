package com.mojolowjo.dataexport;

import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class IndexTest {
    @Test
    void lineNamesEveryWayToGetTheItem() {
        Index.Entry e = new Index.Entry();
        e.id = "minecraft:iron_ingot";
        e.name = "Iron Ingot";
        e.madeBy.put("minecraft:smelting", 2);
        e.madeBy.put("minecraft:blasting", 2);
        e.madeBy.put("create:crushing", 1);
        e.usedIn = 41;
        e.droppedBy.add("minecraft:entities/iron_golem");
        e.tags = 5;
        assertEquals("minecraft:iron_ingot | Iron Ingot | made by: create:crushing, blasting x2, smelting x2 | used in 41 recipes"
                + " | drops from 1 table: minecraft:entities/iron_golem | block: no | tags: 5", Index.line(e));
    }

    @Test
    void anItemWithNoWaySaysSo() {
        Index.Entry e = new Index.Entry();
        e.id = "minecraft:bedrock";
        e.name = "Bedrock";
        e.isBlock = true;
        assertEquals("minecraft:bedrock | Bedrock | made by: no recipe | used in 0 recipes | drops from: nothing known | block: yes | tags: 0", Index.line(e));
    }

    @Test
    void lootScanFindsItemEntriesAtAnyDepth() {
        String table = "{\"type\":\"minecraft:block\",\"pools\":[{\"rolls\":1,\"entries\":[{\"type\":\"minecraft:alternatives\",\"children\":["
                + "{\"type\":\"minecraft:item\",\"name\":\"minecraft:stone\",\"conditions\":[{\"condition\":\"minecraft:match_tool\"}]},"
                + "{\"type\":\"item\",\"name\":\"cobblestone\"}]}]}]}";
        Set<String> items = Index.itemsDroppedBy(JsonParser.parseString(table));
        assertEquals(Set.of("minecraft:stone", "minecraft:cobblestone"), items);
    }

    @Test
    void dataPathsBecomeIds() {
        assertEquals("minecraft:blocks/stone", Names.idFromDataPath("data/minecraft/loot_tables/blocks/stone.json", "loot_tables"));
        assertEquals("create:ore_zinc", Names.idFromDataPath("data\\create\\worldgen\\placed_feature\\ore_zinc.json", "worldgen/placed_feature"));
        assertEquals("tconstruct:materials/stats/wood", Names.idFromDataPath("data/tconstruct/tinkering/materials/stats/wood.json", "tinkering"));
        assertEquals("mce2:mithril_depths", Names.idFromDataPath("data/mce2/forge/biome_modifier/mithril_depths.json", "forge/biome_modifier"));
        assertNull(Names.idFromDataPath("data/minecraft/tags/worldgen/biome/is_overworld.json", "worldgen/biome"));
        assertNull(Names.idFromDataPath("data/minecraft/dimension_type/overworld.json", "dimension"));
        assertNull(Names.idFromDataPath("data/minecraft/recipes/stick.json", "loot_tables"));
        assertNull(Names.idFromDataPath("data/minecraft/loot_tables/blocks/stone.mcmeta", "loot_tables"));
    }

    @Test
    void folderNamesAreSafe() {
        assertEquals("All_the_Mods_9", Names.sanitize("All the Mods 9"));
        assertEquals("play.example.net_25565", Names.sanitize("play.example.net:25565"));
        assertEquals("export", Names.sanitize("..///"));
        assertEquals("export", Names.sanitize(null));
    }
}
