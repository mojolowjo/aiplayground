package com.mojolowjo.craftchain.backpack;

import com.mojolowjo.craftchain.CraftChain;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraftforge.fml.ModList;
import net.minecraftforge.registries.ForgeRegistries;
import org.jetbrains.annotations.Nullable;

import java.lang.reflect.Method;

/**
 * Gets a crafting screen back in front of the player after a backpack was opened for a fetch.
 * Tries, in order: the 2x2 inventory grid when that is enough, Crafting on a Stick in a Curios slot
 * (the mod's own open packet, found by reflection), a Crafting on a Stick item in the hotbar
 * (select it and use it), then the crafting table block the player was looking at when the craft
 * started.
 */
public final class CraftingReopener {
    private static final String COAS_HANDLER = "com.ofek2608.crafting_on_a_stick.network.COASPacketHandler";
    private static final ResourceLocation COAS_TABLE = ResourceLocation.fromNamespaceAndPath("crafting_on_a_stick", "crafting_table");

    private CraftingReopener() {}

    /** Remembers the crafting table block under the crosshair, if any, for later. */
    @Nullable
    public static BlockHitResult lookedAtTable() {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level != null && mc.hitResult instanceof BlockHitResult hit && mc.hitResult.getType() == HitResult.Type.BLOCK
                && mc.level.getBlockState(hit.getBlockPos()).is(Blocks.CRAFTING_TABLE)) {
            return hit;
        }
        return null;
    }

    /**
     * Starts reopening. Returns a short label of the method used, or null when nothing applies.
     * The caller waits for a crafting screen to appear.
     */
    @Nullable
    public static String reopen(int gridNeeded, @Nullable BlockHitResult table) {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        if (player == null) {
            return null;
        }
        if (gridNeeded <= 2) {
            mc.setScreen(new InventoryScreen(player));
            return "inventory";
        }
        if (ModList.get().isLoaded("crafting_on_a_stick")) {
            if (BackpackSupport.curiosLoaded() && !CuriosAccess.findBackpacks(player, CraftingReopener::isCoasTable).isEmpty()) {
                try {
                    Method m = Class.forName(COAS_HANDLER).getMethod("sbOpenCurios");
                    m.invoke(null);
                    return "crafting on a stick (curios)";
                } catch (Throwable t) {
                    CraftChain.LOGGER.warn("Crafting on a Stick curios open failed: {}", t.toString());
                }
            }
            for (int hotbar = 0; hotbar < 9; hotbar++) {
                if (isCoasTable(player.getInventory().getItem(hotbar))) {
                    player.getInventory().selected = hotbar;
                    player.connection.send(new ServerboundSetCarriedItemPacket(hotbar));
                    mc.gameMode.useItem(player, InteractionHand.MAIN_HAND);
                    return "crafting on a stick (hotbar)";
                }
            }
        }
        if (table != null && mc.level != null && mc.level.getBlockState(table.getBlockPos()).is(Blocks.CRAFTING_TABLE)
                && player.position().distanceToSqr(table.getLocation()) < 36) {
            mc.gameMode.useItemOn(player, InteractionHand.MAIN_HAND, table);
            return "crafting table";
        }
        return null;
    }

    private static boolean isCoasTable(ItemStack stack) {
        return !stack.isEmpty() && COAS_TABLE.equals(ForgeRegistries.ITEMS.getKey(stack.getItem()));
    }
}
