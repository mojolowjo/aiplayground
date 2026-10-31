package com.mojolowjo.craftchain.pins;

import com.mojolowjo.craftchain.ClientConfig;
import com.mojolowjo.craftchain.planning.ItemCounts;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraftforge.client.gui.overlay.ForgeGui;
import net.minecraftforge.client.gui.overlay.IGuiOverlay;

import java.util.Map;

/**
 * Draws the pinned list in the corner of the screen:
 *
 * <pre>
 * [icon] Ladder x64
 *     Oak Log  3/20
 * </pre>
 *
 * "have/need" is read from the player's inventory every frame; the breakdown itself is cached in
 * {@link PinnedList}.
 */
public final class PinnedOverlay implements IGuiOverlay {
    private static final int LINE = 10;
    private static final int ICON = 16;
    private static final int GREEN = 0xFF55FF55;
    private static final int RED = 0xFFFF5555;
    private static final int WHITE = 0xFFFFFFFF;
    private static final int GREY = 0xFFAAAAAA;
    private static final int BG = 0x66000000;

    @Override
    public void render(ForgeGui gui, GuiGraphics graphics, float partialTick, int screenWidth, int screenHeight) {
        if (!ClientConfig.SHOW_PINNED_HUD.get()) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.options.hideGui) {
            return;
        }
        PinnedList pins = PinnedList.get();
        if (pins.entries().isEmpty()) {
            return;
        }
        pins.refresh();
        ItemCounts have = ItemCounts.ofPlayerInventory(mc.player.getInventory());
        Font font = mc.font;

        int x = ClientConfig.HUD_X.get();
        int y = ClientConfig.HUD_Y.get();

        // Measure first so the background fits.
        int lines = 0;
        int width = 0;
        for (PinnedList.Entry e : pins.entries()) {
            lines++;
            width = Math.max(width, ICON + 2 + font.width(headerText(e)));
            if (e.raw != null) {
                for (Map.Entry<Item, Integer> r : e.raw.asMap().entrySet()) {
                    lines++;
                    width = Math.max(width, ICON + 4 + font.width(rawText(r.getKey(), have.get(r.getKey()), r.getValue())));
                }
            }
        }
        int height = lines * LINE + 4 + pins.entries().size() * 6;
        graphics.fill(x - 2, y - 2, x + width + 4, y + height, BG);

        int cy = y;
        for (PinnedList.Entry e : pins.entries()) {
            ItemStack icon = new ItemStack(e.item);
            graphics.renderItem(icon, x, cy - 4);
            graphics.drawString(font, headerText(e), x + ICON + 2, cy, WHITE, true);
            cy += LINE;
            if (e.raw == null) {
                graphics.drawString(font, "...", x + ICON + 4, cy, GREY, true);
                cy += LINE;
            } else {
                for (Map.Entry<Item, Integer> r : e.raw.asMap().entrySet()) {
                    int got = have.get(r.getKey());
                    int need = r.getValue();
                    graphics.drawString(font, rawText(r.getKey(), got, need), x + ICON + 4, cy, got >= need ? GREEN : RED, true);
                    cy += LINE;
                }
            }
            cy += 6;
        }
    }

    private static String headerText(PinnedList.Entry e) {
        return new ItemStack(e.item).getHoverName().getString() + " x" + e.count;
    }

    private static String rawText(Item item, int have, int need) {
        return new ItemStack(item).getHoverName().getString() + "  " + have + "/" + need;
    }
}
