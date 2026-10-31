package com.mojolowjo.craftchain.execution;

import com.mojolowjo.craftchain.ClientConfig;
import com.mojolowjo.craftchain.planning.CraftPlan;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Carries out a {@link CraftPlan} by clicking slots in the open crafting menu, exactly as a player
 * would, so it works on any server: every click goes out as a vanilla container-click packet and
 * the server does the actual crafting. No server-side mod is involved.
 *
 * Runs as a state machine advanced once per client tick. Each step is split into batches of at
 * most one stack per grid slot:
 *
 * <ol>
 *   <li>FILL: move ingredients from the inventory into the grid, one click at a time
 *       (left click places a whole carried stack, right click places one item)</li>
 *   <li>CRAFT: shift-click the result slot; the server crafts as many as the grid holds</li>
 *   <li>VERIFY: after a short wait, the grid must be empty, otherwise something went wrong
 *       (inventory full, item moved, recipe not matched) and we stop</li>
 * </ol>
 *
 * The client menu is updated locally by {@code handleInventoryMouseClick}, so the state machine can
 * read the grid and carried stack straight from the menu between clicks.
 */
public final class CraftExecutor {
    private enum Phase { IDLE, PREPARE, FILL, CRAFT, VERIFY, UNLOAD }

    private static final CraftExecutor INSTANCE = new CraftExecutor();

    private Phase phase = Phase.IDLE;
    private CraftPlan plan;
    private int stepIndex;
    private int timesDone;
    private int batch;
    private int containerId;
    private GridLayout layout;
    private int[] stepSlots;
    private final Map<Integer, Item> targetItems = new LinkedHashMap<>();
    private int wait;
    private int resultRetries;
    private Consumer<Component> feedback = c -> {};

    public static CraftExecutor get() {
        return INSTANCE;
    }

    public boolean isRunning() {
        return phase != Phase.IDLE;
    }

    public void setFeedback(Consumer<Component> feedback) {
        this.feedback = feedback;
    }

    /** Starts the plan against the menu that is open right now. */
    public boolean start(CraftPlan plan, AbstractContainerMenu menu) {
        GridLayout l = GridLayout.of(menu);
        if (l == null) {
            feedback.accept(Component.translatable("craftchain.msg.unsupported_menu"));
            return false;
        }
        if (isRunning()) {
            feedback.accept(Component.translatable("craftchain.msg.busy"));
            return false;
        }
        this.plan = plan;
        this.layout = l;
        this.containerId = menu.containerId;
        this.stepIndex = 0;
        this.timesDone = 0;
        this.wait = 0;
        this.resultRetries = 0;
        this.phase = Phase.PREPARE;
        return true;
    }

    public void cancel(String reasonKey) {
        if (phase == Phase.IDLE) {
            return;
        }
        feedback.accept(Component.translatable(reasonKey));
        // Put whatever is in the grid back before giving up.
        phase = Phase.UNLOAD;
    }

    /** Called every client tick (END phase). */
    public void tick() {
        if (phase == Phase.IDLE) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.gameMode == null) {
            reset();
            return;
        }
        AbstractContainerMenu menu = mc.player.containerMenu;
        if (menu.containerId != containerId || !(mc.screen instanceof AbstractContainerScreen<?>)) {
            feedback.accept(Component.translatable("craftchain.msg.screen_closed"));
            reset();
            return;
        }
        if (wait > 0) {
            wait--;
            return;
        }
        switch (phase) {
            case PREPARE -> prepare(menu);
            case FILL -> fill(mc, menu);
            case CRAFT -> craft(mc, menu);
            case VERIFY -> verify(menu);
            case UNLOAD -> unload(mc, menu);
            default -> {}
        }
    }

    private void reset() {
        phase = Phase.IDLE;
        plan = null;
        targetItems.clear();
        stepSlots = null;
    }

    private void prepare(AbstractContainerMenu menu) {
        if (stepIndex >= plan.steps().size()) {
            feedback.accept(Component.translatable("craftchain.msg.done",
                    plan.requested(), new ItemStack(plan.target()).getHoverName()));
            reset();
            return;
        }
        CraftPlan.CraftStep step = plan.steps().get(stepIndex);
        if (timesDone >= step.times()) {
            stepIndex++;
            timesDone = 0;
            return;
        }
        stepSlots = layout.slotsFor(step.recipe());
        if (stepSlots == null) {
            feedback.accept(Component.translatable("craftchain.msg.needs_table"));
            reset();
            return;
        }
        // Batch size: as many crafts as fit in one grid fill, limited by stack size and by what we hold.
        int remaining = step.times() - timesDone;
        int b = remaining;
        Map<Item, Integer> perItem = new LinkedHashMap<>();
        targetItems.clear();
        for (int i = 0; i < stepSlots.length; i++) {
            Item item = step.slotItems()[i];
            if (item == null) {
                continue;
            }
            targetItems.put(stepSlots[i], item);
            perItem.merge(item, 1, Integer::sum);
            b = Math.min(b, new ItemStack(item).getMaxStackSize());
        }
        for (Map.Entry<Item, Integer> e : perItem.entrySet()) {
            int have = countInInventory(menu, e.getKey());
            b = Math.min(b, have / e.getValue());
        }
        if (b <= 0) {
            feedback.accept(Component.translatable("craftchain.msg.ran_out",
                    new ItemStack(perItem.keySet().iterator().next()).getHoverName()));
            reset();
            return;
        }
        batch = b;
        phase = Phase.FILL;
    }

    private void fill(Minecraft mc, AbstractContainerMenu menu) {
        int clicks = ClientConfig.clicksPerTick();
        while (clicks-- > 0) {
            // Anything in the grid that does not belong there goes back to the inventory first.
            int stray = findStrayGridSlot(menu);
            if (stray >= 0) {
                click(mc, stray, 0, ClickType.QUICK_MOVE);
                continue;
            }
            int target = findUnfilledGridSlot(menu);
            ItemStack carried = menu.getCarried();
            if (target < 0) {
                if (!carried.isEmpty()) {
                    int home = findHomeFor(menu, carried);
                    if (home < 0) {
                        feedback.accept(Component.translatable("craftchain.msg.inventory_full"));
                        phase = Phase.UNLOAD;
                        return;
                    }
                    click(mc, home, 0, ClickType.PICKUP);
                    continue;
                }
                phase = Phase.CRAFT;
                return;
            }
            Item want = targetItems.get(target);
            int inGrid = menu.getSlot(target).getItem().getCount();
            int remaining = batch - inGrid;
            if (carried.isEmpty()) {
                int source = findInventorySlot(menu, want);
                if (source < 0) {
                    feedback.accept(Component.translatable("craftchain.msg.ran_out", new ItemStack(want).getHoverName()));
                    phase = Phase.UNLOAD;
                    return;
                }
                click(mc, source, 0, ClickType.PICKUP);
            } else if (carried.getItem() != want) {
                int home = findHomeFor(menu, carried);
                if (home < 0) {
                    feedback.accept(Component.translatable("craftchain.msg.inventory_full"));
                    phase = Phase.UNLOAD;
                    return;
                }
                click(mc, home, 0, ClickType.PICKUP);
            } else if (carried.getCount() <= remaining) {
                click(mc, target, 0, ClickType.PICKUP); // place the whole carried stack
            } else {
                click(mc, target, 1, ClickType.PICKUP); // place one
            }
        }
    }

    private void craft(Minecraft mc, AbstractContainerMenu menu) {
        if (menu.getSlot(layout.resultSlot()).getItem().isEmpty()) {
            // The result slot is only ever filled by the server (the client does not run recipe
            // matching), so reaching this point with an item means the server has caught up with
            // every click we sent. That round trip is the natural brake on how fast we go.
            if (++resultRetries > ClientConfig.ticksAfterCraft() * 4) {
                feedback.accept(Component.translatable("craftchain.msg.no_result"));
                phase = Phase.UNLOAD;
            }
            return;
        }
        resultRetries = 0;
        click(mc, layout.resultSlot(), 0, ClickType.QUICK_MOVE);
        wait = ClientConfig.ticksAfterCraft();
        phase = Phase.VERIFY;
    }

    private void verify(AbstractContainerMenu menu) {
        for (int i = 0; i < layout.gridSlotCount(); i++) {
            if (!menu.getSlot(layout.gridStart() + i).getItem().isEmpty()) {
                feedback.accept(Component.translatable("craftchain.msg.grid_not_empty"));
                phase = Phase.UNLOAD;
                return;
            }
        }
        timesDone += batch;
        wait = ClientConfig.ticksBetweenBatches();
        phase = Phase.PREPARE;
    }

    /** Failure path: shift-click everything out of the grid, then stop. */
    private void unload(Minecraft mc, AbstractContainerMenu menu) {
        int clicks = ClientConfig.clicksPerTick();
        while (clicks-- > 0) {
            if (!menu.getCarried().isEmpty()) {
                int home = findHomeFor(menu, menu.getCarried());
                if (home < 0) {
                    break;
                }
                click(mc, home, 0, ClickType.PICKUP);
                continue;
            }
            int occupied = -1;
            for (int i = 0; i < layout.gridSlotCount(); i++) {
                int slot = layout.gridStart() + i;
                if (!menu.getSlot(slot).getItem().isEmpty()) {
                    occupied = slot;
                    break;
                }
            }
            if (occupied < 0) {
                reset();
                return;
            }
            click(mc, occupied, 0, ClickType.QUICK_MOVE);
        }
    }

    // ---- helpers -------------------------------------------------------------------------

    private void click(Minecraft mc, int slot, int button, ClickType type) {
        mc.gameMode.handleInventoryMouseClick(containerId, slot, button, type, mc.player);
    }

    private int findStrayGridSlot(AbstractContainerMenu menu) {
        for (int i = 0; i < layout.gridSlotCount(); i++) {
            int slot = layout.gridStart() + i;
            ItemStack in = menu.getSlot(slot).getItem();
            if (in.isEmpty()) {
                continue;
            }
            Item want = targetItems.get(slot);
            if (want == null || in.getItem() != want || in.getCount() > batch) {
                return slot;
            }
        }
        return -1;
    }

    private int findUnfilledGridSlot(AbstractContainerMenu menu) {
        for (Map.Entry<Integer, Item> e : targetItems.entrySet()) {
            if (menu.getSlot(e.getKey()).getItem().getCount() < batch) {
                return e.getKey();
            }
        }
        return -1;
    }

    private int findInventorySlot(AbstractContainerMenu menu, Item item) {
        int best = -1;
        int bestCount = 0;
        for (int slot = layout.invStart(); slot < layout.invEnd(); slot++) {
            ItemStack s = menu.getSlot(slot).getItem();
            if (!s.isEmpty() && s.getItem() == item && s.getCount() > bestCount) {
                best = slot;
                bestCount = s.getCount();
            }
        }
        return best;
    }

    /** An inventory slot that can take the carried stack: same item with room, else an empty slot. */
    private int findHomeFor(AbstractContainerMenu menu, ItemStack carried) {
        for (int slot = layout.invStart(); slot < layout.invEnd(); slot++) {
            ItemStack s = menu.getSlot(slot).getItem();
            if (!s.isEmpty() && ItemStack.isSameItemSameTags(s, carried) && s.getCount() < s.getMaxStackSize()) {
                return slot;
            }
        }
        for (int slot = layout.invStart(); slot < layout.invEnd(); slot++) {
            if (menu.getSlot(slot).getItem().isEmpty()) {
                return slot;
            }
        }
        return -1;
    }

    private int countInInventory(AbstractContainerMenu menu, Item item) {
        int n = 0;
        for (int slot = layout.invStart(); slot < layout.invEnd(); slot++) {
            ItemStack s = menu.getSlot(slot).getItem();
            if (!s.isEmpty() && s.getItem() == item) {
                n += s.getCount();
            }
        }
        // Items already sitting in the grid for this step count too.
        for (Map.Entry<Integer, Item> e : targetItems.entrySet()) {
            ItemStack s = menu.getSlot(e.getKey()).getItem();
            if (!s.isEmpty() && s.getItem() == item) {
                n += s.getCount();
            }
        }
        if (!menu.getCarried().isEmpty() && menu.getCarried().getItem() == item) {
            n += menu.getCarried().getCount();
        }
        return n;
    }
}
