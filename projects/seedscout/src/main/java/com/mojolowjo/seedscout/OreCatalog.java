package com.mojolowjo.seedscout;

import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.tags.TagKey;
import net.minecraft.world.level.block.Block;
import net.minecraftforge.registries.ForgeRegistries;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * The ores the filter can name: every block in {@code #forge:ores} as the client knows the tag, the ids in the
 * scan list, and every id the scout has reported. Grouped into families with a display name and the count
 * cached within range. Client side; refreshed on demand (cheap).
 */
public final class OreCatalog {
    private OreCatalog() {}

    public record Family(String name, String displayName, List<String> ids, int nearby) {}

    /** All known ore ids. */
    public static Set<String> ids() {
        Set<String> ids = new LinkedHashSet<>();
        for (String entry : ClientConfig.ores()) {
            try {
                if (entry.startsWith("#")) {
                    TagKey<Block> key = TagKey.create(Registries.BLOCK, new ResourceLocation(entry.substring(1)));
                    if (ForgeRegistries.BLOCKS.tags() != null && ForgeRegistries.BLOCKS.tags().isKnownTagName(key))
                        for (Block b : ForgeRegistries.BLOCKS.tags().getTag(key)) {
                            ResourceLocation rl = ForgeRegistries.BLOCKS.getKey(b);
                            if (rl != null) ids.add(rl.toString());
                        }
                } else if (ForgeRegistries.BLOCKS.containsKey(new ResourceLocation(entry))) {
                    ids.add(entry);
                }
            } catch (RuntimeException ignored) {
                // a bad entry in the config
            }
        }
        Minecraft mc = Minecraft.getInstance();
        if (mc.level != null) ids.addAll(ScoutLink.store(mc.level.dimension().location().toString()).countsById().keySet());
        return ids;
    }

    public static List<String> familyNames() {
        return new ArrayList<>(OreFilter.families(ids()).keySet());
    }

    /** Families with display names and nearby counts (the current dimension's cache within range). */
    public static List<Family> families() {
        Map<String, List<String>> fams = OreFilter.families(ids());
        Map<String, Integer> near = nearbyCounts();
        List<Family> out = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : fams.entrySet()) {
            int n = 0;
            for (String id : e.getValue()) n += near.getOrDefault(id, 0);
            out.add(new Family(e.getKey(), displayName(e.getValue()), e.getValue(), n));
        }
        return out;
    }

    /** The in-game name of the family's plain (non-deepslate) block, else of its first block. */
    static String displayName(List<String> ids) {
        String pick = ids.get(0);
        for (String id : ids) if (!id.contains("deepslate")) { pick = id; break; }
        try {
            Block b = ForgeRegistries.BLOCKS.getValue(new ResourceLocation(pick));
            if (b != null) {
                String name = b.getName().getString();
                if (name.endsWith(" Ore")) name = name.substring(0, name.length() - 4);
                return name;
            }
        } catch (RuntimeException ignored) {
        }
        return OreFilter.family(pick);
    }

    /** id -> ores within range of the player in the current dimension's cache. */
    public static Map<String, Integer> nearbyCounts() {
        Map<String, Integer> m = new TreeMap<>();
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null || mc.player == null) return m;
        OreStore store = ScoutLink.store(mc.level.dimension().location().toString());
        int range = ClientConfig.RANGE.get();
        int pcx = mc.player.chunkPosition().x, pcz = mc.player.chunkPosition().z;
        for (OreStore.ChunkOres c : store.snapshot()) {
            if (Math.abs(c.x - pcx) > range || Math.abs(c.z - pcz) > range) continue;
            for (OreStore.Ore o : c.ores) m.merge(o.id(), 1, Integer::sum);
        }
        return m;
    }

    /** Family -> nearby count, only shown families with a count, for the legend. */
    public static Map<String, Integer> legendCounts(Collection<String> shown) {
        Map<String, Integer> out = new TreeMap<>();
        for (Map.Entry<String, Integer> e : nearbyCounts().entrySet())
            if (OreFilter.isShown(e.getKey(), shown)) out.merge(OreFilter.family(e.getKey()), e.getValue(), Integer::sum);
        return out;
    }
}
