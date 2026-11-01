package com.mojolowjo.craftchain;

import com.mojolowjo.craftchain.execution.GridLayout;
import com.mojolowjo.craftchain.planning.CraftPlan;
import com.mojolowjo.craftchain.planning.CraftPlanner;
import com.mojolowjo.craftchain.planning.ItemCounts;
import com.mojolowjo.craftchain.planning.RecipeIndex;
import com.mojolowjo.craftchain.planning.Stock;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import org.jetbrains.annotations.Nullable;

import java.util.Map;

/**
 * The "how many?" prompt. First G press on a hovered item opens it, the scroll wheel changes the
 * amount, a second G confirms, Esc or a click cancels. While open it shows whether the amount is
 * craftable from what you own, and what would have to come out of a backpack.
 */
public final class CraftPrompt {
    private static final CraftPrompt INSTANCE = new CraftPrompt();
    public static final int MAX_AMOUNT = 9999;

    private boolean active;
    private ItemStack target = ItemStack.EMPTY;
    private int amount = 1;
    @Nullable
    private Screen screen;
    private int checkedAmount = -1;
    private int checkedStock = 0;
    private String checkText = "";
    private int checkColor = 0xFFFFFFFF;

    public static CraftPrompt get() {
        return INSTANCE;
    }

    public boolean isActive() {
        return active;
    }

    public ItemStack target() {
        return target;
    }

    public int amount() {
        return amount;
    }

    public void open(Screen screen, ItemStack stack, int startAmount) {
        this.screen = screen;
        this.target = stack.copy();
        this.amount = Math.max(1, Math.min(MAX_AMOUNT, startAmount));
        this.active = true;
        this.checkedAmount = -1;
    }

    public void close() {
        active = false;
        screen = null;
        target = ItemStack.EMPTY;
        checkedAmount = -1;
    }

    public void adjust(int delta) {
        amount = Math.max(1, Math.min(MAX_AMOUNT, amount + delta));
    }

    public void render(Screen current, GuiGraphics graphics, int mouseX, int mouseY) {
        if (!active) {
            return;
        }
        if (current != screen) {
            close();
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        Font font = mc.font;
        refreshCheck(mc);

        String line1 = "Craft " + target.getHoverName().getString() + " x" + amount;
        String line2 = "Scroll: amount (Shift x16)   G: confirm   Esc: cancel";
        int w = Math.max(Math.max(font.width(line1) + 20, font.width(line2)), font.width(checkText)) + 8;
        int h = 10 * 3 + 10;
        int x = Math.min(mouseX + 12, graphics.guiWidth() - w - 2);
        int y = Math.min(mouseY + 12, graphics.guiHeight() - h - 2);

        graphics.pose().pushPose();
        graphics.pose().translate(0, 0, 500);
        graphics.fill(x - 3, y - 3, x + w + 3, y + h, 0xF0100010);
        graphics.renderOutline(x - 3, y - 3, w + 6, h + 3, 0xFF5000FF);
        graphics.renderItem(target, x, y);
        graphics.drawString(font, line1, x + 20, y + 4, 0xFFFFFFFF, true);
        graphics.drawString(font, checkText, x, y + 18, checkColor, true);
        graphics.drawString(font, line2, x, y + 30, 0xFFAAAAAA, true);
        graphics.pose().popPose();
    }

    private void refreshCheck(Minecraft mc) {
        Stock stock = Stock.snapshot();
        if ((checkedAmount == amount && checkedStock == stock.key()) || mc.player == null) {
            return;
        }
        checkedAmount = amount;
        checkedStock = stock.key();
        RecipeIndex index = RecipeIndex.get();
        if (index == null) {
            checkText = "Recipes not loaded";
            checkColor = 0xFFFF5555;
            return;
        }
        AbstractContainerMenu menu = mc.player.containerMenu;
        GridLayout layout = GridLayout.of(menu);
        int grid = layout == null ? 3 : layout.gridSize();
        Item item = target.getItem();
        ItemCounts owned = stock.total().copy();
        owned.take(item, Integer.MAX_VALUE);
        CraftPlan plan = new CraftPlanner(index, grid, stock.inventory()).plan(item, amount, owned);
        if (plan.steps().isEmpty() && plan.missing().isEmpty()) {
            checkText = "No crafting recipe";
            checkColor = 0xFFFF5555;
        } else if (!plan.missing().isEmpty()) {
            StringBuilder sb = new StringBuilder("Missing: ");
            boolean first = true;
            for (Map.Entry<Item, Integer> e : plan.missing().asMap().entrySet()) {
                if (!first) {
                    sb.append(", ");
                }
                first = false;
                sb.append(e.getValue()).append("x ").append(new ItemStack(e.getKey()).getHoverName().getString());
            }
            sb.append("  - G pins it");
            checkText = sb.toString();
            checkColor = 0xFFFFAA00;
        } else if (plan.needsBigGrid()) {
            checkText = "Needs a crafting table";
            checkColor = 0xFFFFAA00;
        } else {
            int fromPacks = 0;
            for (Map.Entry<Item, Integer> e : plan.used().asMap().entrySet()) {
                fromPacks += Math.max(0, e.getValue() - stock.inventory().get(e.getKey()));
            }
            checkText = "Ready: " + plan.steps().size() + " recipes, " + plan.totalCrafts() + " crafts"
                    + (fromPacks > 0 ? ", " + fromPacks + " items from backpacks" : "");
            checkColor = 0xFF55FF55;
        }
    }
}
