package com.mojolowjo.dataexport;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.level.biome.BiomeManager;
import net.minecraftforge.event.TickEvent;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The hashed world seed per dimension. The server sends {@code BiomeManager.obfuscateSeed(seed)} in
 * ClientboundLoginPacket#seed() and ClientboundRespawnPacket#seed(); the client keeps it as the one
 * {@code long} field of the level's BiomeManager (biomeZoomSeed). Read there, by type, so no mixin
 * and no access transformer is needed and the name does not matter in production.
 * Every new client level seen on the client tick is recorded under its dimension id.
 */
public final class SeedTracker {
    private SeedTracker() {}

    private static final Map<String, Long> SEEDS = new LinkedHashMap<>();
    private static ClientLevel lastLevel;
    private static String lastError;

    public static void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) return;
        ClientLevel level = Minecraft.getInstance().level;
        if (level == lastLevel) return;
        lastLevel = level;
        if (level != null) record(level);
    }

    /** Records the level's hashed seed under its dimension id; returns the error text, or null. */
    public static synchronized String record(ClientLevel level) {
        String dim = level.dimension().location().toString();
        try {
            SEEDS.put(dim, zoomSeed(level.getBiomeManager()));
            lastError = null;
        } catch (Throwable t) {
            lastError = "hashed seed of " + dim + ": " + t;
            DataExport.LOGGER.warn("[dataexport] {}", lastError);
        }
        return lastError;
    }

    /** Dimension id -> hashed seed, in the order the dimensions were entered. */
    public static synchronized Map<String, Long> seeds() {
        return new LinkedHashMap<>(SEEDS);
    }

    public static synchronized String lastError() {
        return lastError;
    }

    /** BiomeManager's one non-static long field; an error when there is not exactly one. */
    static long zoomSeed(BiomeManager manager) throws ReflectiveOperationException {
        Field found = null;
        int n = 0;
        for (Field f : BiomeManager.class.getDeclaredFields()) {
            if (Modifier.isStatic(f.getModifiers()) || f.getType() != long.class) continue;
            found = f;
            n++;
        }
        if (n != 1 || found == null) throw new ReflectiveOperationException("BiomeManager has " + n + " long fields, expected the one biomeZoomSeed");
        found.setAccessible(true);
        return found.getLong(manager);
    }
}
