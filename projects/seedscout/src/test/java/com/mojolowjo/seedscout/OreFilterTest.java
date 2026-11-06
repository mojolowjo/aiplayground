package com.mojolowjo.seedscout;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class OreFilterTest {
    @Test
    void familyNames() {
        assertEquals("diamond", OreFilter.family("minecraft:diamond_ore"));
        assertEquals("diamond", OreFilter.family("minecraft:deepslate_diamond_ore"));
        assertEquals("mithril", OreFilter.family("irons_spellbooks:deepslate_mithril_ore"));
        assertEquals("ancient_debris", OreFilter.family("minecraft:ancient_debris"));
        assertEquals("nether_gold", OreFilter.family("minecraft:nether_gold_ore"));
        assertEquals("bismuthinite", OreFilter.family("tinkers_advanced:bismuthinite_ore"));
    }

    @Test
    void parsingAndPresets() {
        assertEquals(List.of("diamond", "mithril", "ancient_debris"), OreFilter.parseList("Diamond, mithril ancient_debris,"));
        assertEquals(List.of("mithril", "bismuthinite"), OreFilter.expand(List.of("pack")));
        assertEquals(List.of(), OreFilter.expand(List.of("diamond", "none")));
        assertTrue(OreFilter.expand(List.of("valuables")).contains("ancient_debris"));
    }

    @Test
    void shownAddRemove() {
        List<String> cat = List.of("coal", "diamond", "iron", "mithril");
        assertTrue(OreFilter.isShown("minecraft:coal_ore", List.of("all")));
        assertTrue(OreFilter.isShown("minecraft:deepslate_diamond_ore", List.of("diamond")));
        assertFalse(OreFilter.isShown("minecraft:coal_ore", List.of("diamond")));
        assertTrue(OreFilter.isShown("minecraft:coal_ore", List.of("minecraft:coal_ore")), "a full id works too");
        assertEquals(List.of("all"), OreFilter.add(List.of("all"), List.of("diamond")));
        assertEquals(List.of("diamond", "mithril", "bismuthinite"), OreFilter.add(List.of("diamond"), List.of("pack")));
        assertEquals(List.of("coal", "iron", "mithril"), OreFilter.remove(List.of("all"), List.of("diamond"), cat), "removing from all uses the catalog");
        assertEquals(List.of("diamond"), OreFilter.remove(List.of("diamond", "iron"), List.of("minecraft:iron_ore"), cat), "an id removes its family");
        assertEquals(List.of("coal", "diamond", "iron"), OreFilter.toggle(List.of("all"), "mithril", false, cat));
    }

    @Test
    void familiesAndSuggestions() {
        Map<String, List<String>> f = OreFilter.families(List.of("minecraft:deepslate_diamond_ore", "minecraft:diamond_ore", "irons_spellbooks:mithril_ore"));
        assertEquals(List.of("diamond", "mithril"), List.copyOf(f.keySet()));
        assertEquals(2, f.get("diamond").size());
        List<String> s = OreFilter.suggest("mi", f.keySet(), List.of("minecraft:diamond_ore", "irons_spellbooks:mithril_ore"));
        assertEquals("mithril", s.get(0), "prefix matches first");
        assertTrue(s.contains("minecraft:diamond_ore"));
        assertTrue(s.contains("irons_spellbooks:mithril_ore"), "ids whose path starts with the text");
        assertTrue(OreFilter.suggest("", f.keySet(), List.of()).containsAll(List.of("all", "none", "valuables", "diamond")));
        assertEquals(9, OreFilter.tokenStart("diamond, mithril"));
        assertEquals(0, OreFilter.tokenStart("dia"));
        assertEquals(8, OreFilter.tokenStart("diamond,"));
    }
}
