package com.mojolowjo.seedscout;

import com.mojang.logging.LogUtils;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.DistExecutor;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.loading.FMLEnvironment;
import org.slf4j.Logger;

/**
 * Seedscout: one jar, two jobs.
 * <ul>
 *   <li>Client: sets up and runs a local "scout" dedicated server with the real server's seed and mods,
 *       asks it for ore positions around the player and draws them through walls. {@link SeedScoutClient}.</li>
 *   <li>Scout server (a dedicated server started with {@code -Dseedscout.scout=true}): generates the
 *       requested chunks, scans them for the requested blocks and answers over a localhost socket.
 *       {@link ScoutServer}.</li>
 * </ul>
 * On any other dedicated server the mod does nothing.
 */
@Mod(SeedScout.MOD_ID)
public final class SeedScout {
    public static final String MOD_ID = "seedscout";
    public static final Logger LOGGER = LogUtils.getLogger();
    public static final String SCOUT_PROPERTY = "seedscout.scout";

    public SeedScout() {
        if (FMLEnvironment.dist == Dist.DEDICATED_SERVER) {
            if (Boolean.getBoolean(SCOUT_PROPERTY)) {
                ScoutServer.init();
                LOGGER.info("[seedscout] scout server mode");
            } else {
                LOGGER.info("[seedscout] dedicated server without -D{}=true: idle", SCOUT_PROPERTY);
            }
            return;
        }
        DistExecutor.unsafeRunWhenOn(Dist.CLIENT, () -> SeedScoutClient::init);
    }
}
