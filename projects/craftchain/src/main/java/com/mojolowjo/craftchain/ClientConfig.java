package com.mojolowjo.craftchain;

import net.minecraft.client.Minecraft;
import net.minecraftforge.common.ForgeConfigSpec;

/** Client config, written to config/craftchain-client.toml on first launch. */
public final class ClientConfig {
    public static final ForgeConfigSpec SPEC;

    public static final ForgeConfigSpec.IntValue MAX_CRAFTS_PER_RUN;
    public static final ForgeConfigSpec.IntValue SP_CLICKS_PER_TICK;
    public static final ForgeConfigSpec.IntValue SP_TICKS_AFTER_CRAFT;
    public static final ForgeConfigSpec.IntValue SP_TICKS_BETWEEN_BATCHES;
    public static final ForgeConfigSpec.IntValue MP_CLICKS_PER_TICK;
    public static final ForgeConfigSpec.IntValue MP_TICKS_AFTER_CRAFT;
    public static final ForgeConfigSpec.IntValue MP_TICKS_BETWEEN_BATCHES;
    public static final ForgeConfigSpec.IntValue MAX_PLAN_DEPTH;
    public static final ForgeConfigSpec.IntValue MAX_RECIPES_PER_ITEM;
    public static final ForgeConfigSpec.BooleanValue SHOW_PINNED_HUD;
    public static final ForgeConfigSpec.IntValue HUD_X;
    public static final ForgeConfigSpec.IntValue HUD_Y;
    public static final ForgeConfigSpec.BooleanValue CHAT_FEEDBACK;

    static {
        ForgeConfigSpec.Builder b = new ForgeConfigSpec.Builder();

        b.push("crafting");
        MAX_CRAFTS_PER_RUN = b.comment(
                "Refuse any plan with more than this many crafts in total (all steps added up).",
                "A stack of ladders is about 80 crafts. This is the safety net against a runaway chain.")
                .defineInRange("maxCraftsPerRun", 128, 1, 10000);
        b.pop();

        // Every click is one packet to the server. Singleplayer can go fast; on a server we pace
        // ourselves so the click rate stays near what a quick human could do, which keeps the
        // server's inventory in step with ours and stays clear of any packet-spam protection.
        b.comment("Speed when playing singleplayer (the integrated server).").push("singleplayer");
        SP_CLICKS_PER_TICK = b.comment("Container clicks sent per game tick while filling the grid.")
                .defineInRange("clicksPerTick", 6, 1, 64);
        SP_TICKS_AFTER_CRAFT = b.comment("Ticks to wait after taking the result before checking that the grid emptied.")
                .defineInRange("ticksAfterCraft", 3, 1, 200);
        SP_TICKS_BETWEEN_BATCHES = b.comment("Extra ticks to pause between one grid fill and the next.")
                .defineInRange("ticksBetweenBatches", 0, 0, 200);
        b.pop();

        b.comment("Speed when connected to a server. Keep these conservative.").push("multiplayer");
        MP_CLICKS_PER_TICK = b.comment(
                "Container clicks sent per game tick while filling the grid. 1 = 20 clicks per second.",
                "Lower this to 1 and raise the waits if a server kicks for packet spam.")
                .defineInRange("clicksPerTick", 1, 1, 64);
        MP_TICKS_AFTER_CRAFT = b.comment(
                "Ticks to wait after taking the result before checking that the grid emptied.",
                "This must cover a full round trip to the server; raise it when laggy.")
                .defineInRange("ticksAfterCraft", 8, 1, 200);
        MP_TICKS_BETWEEN_BATCHES = b.comment("Extra ticks to pause between one grid fill and the next.")
                .defineInRange("ticksBetweenBatches", 5, 0, 200);
        b.pop();

        b.push("planning");
        MAX_PLAN_DEPTH = b.comment("How many crafting steps deep a chain may go (ladder -> stick -> plank -> log is 3).")
                .defineInRange("maxPlanDepth", 8, 1, 32);
        MAX_RECIPES_PER_ITEM = b.comment("How many alternative recipes for one item the planner tries before it picks the best one it saw.")
                .defineInRange("maxRecipesPerItem", 3, 1, 10);
        b.pop();

        b.push("hud");
        SHOW_PINNED_HUD = b.comment("Draw the pinned-items list on screen.").define("showPinnedList", true);
        HUD_X = b.comment("Left edge of the pinned list, in GUI pixels.").defineInRange("x", 4, 0, 10000);
        HUD_Y = b.comment("Top edge of the pinned list, in GUI pixels.").defineInRange("y", 4, 0, 10000);
        CHAT_FEEDBACK = b.comment("Print what CraftChain is doing to chat.").define("chatFeedback", true);
        b.pop();

        SPEC = b.build();
    }

    /** True when the game runs its own integrated server (singleplayer or LAN host). */
    public static boolean singleplayer() {
        return Minecraft.getInstance().hasSingleplayerServer();
    }

    public static int clicksPerTick() {
        return singleplayer() ? SP_CLICKS_PER_TICK.get() : MP_CLICKS_PER_TICK.get();
    }

    public static int ticksAfterCraft() {
        return singleplayer() ? SP_TICKS_AFTER_CRAFT.get() : MP_TICKS_AFTER_CRAFT.get();
    }

    public static int ticksBetweenBatches() {
        return singleplayer() ? SP_TICKS_BETWEEN_BATCHES.get() : MP_TICKS_BETWEEN_BATCHES.get();
    }

    private ClientConfig() {}
}
