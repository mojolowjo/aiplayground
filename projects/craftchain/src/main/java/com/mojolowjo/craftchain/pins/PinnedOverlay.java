package com.mojolowjo.craftchain.pins;

import com.mojolowjo.craftchain.ClientConfig;
import com.mojolowjo.craftchain.planning.RecipeIndex;
import com.mojolowjo.craftchain.planning.Stock;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraftforge.client.gui.overlay.ForgeGui;
import net.minecraftforge.client.gui.overlay.IGuiOverlay;

import java.util.Map;

/**
 * Draws the pinned list, in the world (as a Forge GUI overlay) and on top of any open screen
 * (from ScreenEvent.Render.Post):
 *
 * <pre>
 * [icon] Ladder x64                        [READY]
 *        [##########----------]  12/20
 *          Oak Log (any #minecraft:logs)  3/20
 *          Stick  8/8
 * </pre>
 *
 * Each line is an item the real plan would take: green when the stock covers it, red when the plan
 * is short of it. The bar is the covered share. Intermediates you already hold (sticks) show up as
 * covered lines instead of being broken down further, because the plan would use them as they are.
 */
public final class PinnedOverlay implements IGuiOverlay {
    private static final int LINE = 10;
    private static final int ICON = 16;
    private static final int BAR_W = 100;
    private static final int BAR_H = 5;
    private static final int GREEN = 0xFF55FF55;
    private static final int RED = 0xFFFF5555;
    private static final int WHITE = 0xFFFFFFFF;
    private static final int GREY = 0xFFAAAAAA;
    private static final int BG = 0x80000000;
    private static final int BAR_BG = 0xFF303030;
    private static final int BAR_FILL = 0xFF40C040;
    private static final int BAR_DONE = 0xFF80FF80;

    @Override
    public void render(ForgeGui gui, GuiGraphics graphics, float partialTick, int screenWidth, int screenHeight) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.screen != null || mc.options.hideGui) {
            return; // drawn by the screen hook instead
        }
        draw(graphics);
    }

    /** Draws the list at the configured position. Safe to call from any render event. */
    public static void draw(GuiGraphics graphics) {
        if (!ClientConfig.SHOW_PINNED_HUD.get()) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null) {
            return;
        }
        PinnedList pins = PinnedList.get();
        if (pins.entries().isEmpty()) {
            return;
        }
        Stock stock = Stock.snapshot();
        pins.refresh(stock);
        RecipeIndex index = RecipeIndex.get();
        Font font = mc.font;
        boolean materials = ClientConfig.SHOW_MATERIALS.get();

        int x = ClientConfig.HUD_X.get();
        int y = ClientConfig.HUD_Y.get();

        int height = 0;
        int width = ICON + 4 + BAR_W + 50;
        for (PinnedList.Entry e : pins.entries()) {
            height += LINE + BAR_H + 4;
            width = Math.max(width, ICON + 2 + font.width(headerText(e)) + 50);
            if (materials) {
                if (!e.computed) {
                    height += LINE;
                } else if (e.hasRecipe) {
                    for (Map.Entry<Item, Integer> r : e.needs().entrySet()) {
                        height += LINE;
                        width = Math.max(width, ICON + 6 + font.width(lineText(index, e, stock, r.getKey(), r.getValue())));
                    }
                }
            }
            height += 4;
        }
        graphics.pose().pushPose();
        graphics.pose().translate(0, 0, 300);
        graphics.fill(x - 3, y - 3, x + width + 3, y + height, BG);

        int cy = y;
        for (PinnedList.Entry e : pins.entries()) {
            graphics.renderItem(new ItemStack(e.item), x, cy - 3);
            graphics.drawString(font, headerText(e), x + ICON + 2, cy, WHITE, true);

            int need = e.needTotal();
            int got = e.used.total();
            if (e.craftable) {
                graphics.drawString(font, "[READY]", x + width - font.width("[READY]"), cy, GREEN, true);
            } else if (e.computed && !e.hasRecipe) {
                graphics.drawString(font, "no recipe", x + width - font.width("no recipe"), cy, GREY, true);
            }
            cy += LINE;

            int bx = x + ICON + 4;
            graphics.fill(bx, cy, bx + BAR_W, cy + BAR_H, BAR_BG);
            if (need > 0) {
                int fill = e.craftable ? BAR_W : (int) Math.round((double) BAR_W * got / need);
                graphics.fill(bx, cy, bx + Math.max(0, Math.min(BAR_W, fill)), cy + BAR_H, e.craftable ? BAR_DONE : BAR_FILL);
            }
            graphics.drawString(font, got + "/" + need, bx + BAR_W + 4, cy - 2, e.craftable ? GREEN : WHITE, true);
            cy += BAR_H + 4;

            if (materials) {
                if (!e.computed) {
                    graphics.drawString(font, "...", x + ICON + 6, cy, GREY, true);
                    cy += LINE;
                } else if (e.hasRecipe) {
                    for (Map.Entry<Item, Integer> r : e.needs().entrySet()) {
                        boolean ok = e.missing.get(r.getKey()) == 0;
                        graphics.drawString(font, lineText(index, e, stock, r.getKey(), r.getValue()), x + ICON + 6, cy, ok ? GREEN : RED, true);
                        cy += LINE;
                    }
                }
            }
            cy += 4;
        }
        graphics.pose().popPose();
    }

    private static String headerText(PinnedList.Entry e) {
        return new ItemStack(e.item).getHoverName().getString() + " x" + e.count;
    }

    /** "Oak Log (any #minecraft:logs)  3/20": what the plan takes of this item, and how much of that you have. */
    private static String lineText(RecipeIndex index, PinnedList.Entry e, Stock stock, Item item, int need) {
        Item[] alts = e.alternatives.get(item);
        String label = index == null || alts == null ? null : index.groupLabel(alts);
        String name = new ItemStack(item).getHoverName().getString();
        if (label != null) {
            name += " (any " + label + ")";
        }
        int have = Math.min(need, Math.max(e.used.get(item), stock.totalOfAny(item, alts)));
        return name + "  " + have + "/" + need;
    }
}
