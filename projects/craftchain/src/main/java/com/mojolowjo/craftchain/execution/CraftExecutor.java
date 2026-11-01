package com.mojolowjo.craftchain.execution;

import com.mojolowjo.craftchain.ClientConfig;
import com.mojolowjo.craftchain.backpack.BackpackInfo;
import com.mojolowjo.craftchain.backpack.BackpackSupport;
import com.mojolowjo.craftchain.backpack.CraftingReopener;
import com.mojolowjo.craftchain.planning.CraftPlan;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.BlockHitResult;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Carries out a {@link CraftPlan} by clicking slots exactly as a player would, so it works on any
 * server: every click is a vanilla container-click packet and the server does the actual crafting.
 *
 * Runs as a state machine advanced once per client tick:
 * <ol>
 *   <li>FETCH_*: for items that only exist in a backpack, open that backpack (the backpack mod's
 *       own packet), shift-click the needed stacks into the inventory, close it</li>
 *   <li>REOPEN_*: get a crafting screen back (inventory 2x2, Crafting on a Stick, or the table)</li>
 *   <li>PREPARE / FILL / CRAFT / VERIFY: per recipe step, in batches of at most one stack per grid
 *       slot: fill the grid, shift-click the result, require an empty grid afterwards</li>
 * </ol>
 * The client menu is updated locally by {@code handleInventoryMouseClick}, so the state machine can
 * read the grid and carried stack straight from the menu between clicks.
 */
public final class CraftExecutor {
    private enum Phase { IDLE, FETCH_OPEN, FETCH_WAIT, FETCH_PULL, FETCH_CLOSE, REOPEN, REOPEN_WAIT, PREPARE, FILL, CRAFT, VERIFY, UNLOAD }

    /** Take {@code count} of {@code item} out of {@code pack}. */
    public record FetchTask(BackpackInfo pack, Item item, int count) {}

    private static final CraftExecutor INSTANCE = new CraftExecutor();
    private static final int OPEN_TIMEOUT = 60;

    private Phase phase = Phase.IDLE;
    private CraftPlan plan;
    private int stepIndex;
    private int timesDone;
    private int batch;
    private int containerId;
    private GridLayout layout;
    private int gridNeeded;
    private int[] stepSlots;
    private final Map<Integer, Item> targetItems = new LinkedHashMap<>();
    private int wait;
    private int timeout;
    private int resultRetries;
    private Consumer<Component> feedback = c -> {};

    private final List<FetchTask> fetches = new ArrayList<>();
    private final Map<Item, Integer> fetchLeft = new LinkedHashMap<>();
    @Nullable
    private BackpackInfo currentPack;
    @Nullable
    private BlockHitResult table;

    public static CraftExecutor get() {
        return INSTANCE;
    }

    public boolean isRunning() {
        return phase != Phase.IDLE;
    }

    public void setFeedback(Consumer<Component> feedback) {
        this.feedback = feedback;
    }

    /**
     * Starts the plan against the menu that is open right now.
     *
     * @param fetches items to pull out of backpacks first (may be empty)
     * @param table   the crafting table block the player is looking at, for reopening, or null
     */
    public boolean start(CraftPlan plan, AbstractContainerMenu menu, List<FetchTask> fetches, @Nullable BlockHitResult table) {
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
        this.gridNeeded = 2;
        for (CraftPlan.CraftStep step : plan.steps()) {
            if (!step.recipe().canCraftInDimensions(2, 2)) {
                gridNeeded = 3;
            }
        }
        this.table = table;
        this.fetches.clear();
        this.fetches.addAll(fetches);
        this.stepIndex = 0;
        this.timesDone = 0;
        this.wait = 0;
        this.resultRetries = 0;
        this.phase = fetches.isEmpty() ? Phase.PREPARE : Phase.FETCH_OPEN;
        return true;
    }

    public void cancel(String reasonKey) {
        if (phase == Phase.IDLE) {
            return;
        }
        feedback.accept(Component.translatable(reasonKey));
        if (phase.ordinal() >= Phase.PREPARE.ordinal()) {
            phase = Phase.UNLOAD;
        } else {
            reset();
        }
    }

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
        if (wait > 0) {
            wait--;
            return;
        }
        switch (phase) {
            case FETCH_OPEN -> fetchOpen(mc, menu);
            case FETCH_WAIT -> fetchWait(mc, menu);
            case FETCH_PULL -> fetchPull(mc, menu);
            case FETCH_CLOSE -> fetchClose(mc);
            case REOPEN -> reopen(mc);
            case REOPEN_WAIT -> reopenWait(mc, menu);
            default -> {
                if (menu.containerId != containerId || !(mc.screen instanceof AbstractContainerScreen<?>)) {
                    feedback.accept(Component.translatable("craftchain.msg.screen_closed"));
                    reset();
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
        }
    }

    private void reset() {
        phase = Phase.IDLE;
        plan = null;
        targetItems.clear();
        stepSlots = null;
        fetches.clear();
        fetchLeft.clear();
        currentPack = null;
        table = null;
    }

    // ---- fetching from backpacks -----------------------------------------------------------

    private void fetchOpen(Minecraft mc, AbstractContainerMenu menu) {
        if (fetches.isEmpty()) {
            phase = Phase.REOPEN;
            return;
        }
        currentPack = fetches.get(0).pack();
        fetchLeft.clear();
        for (FetchTask t : fetches) {
            if (t.pack().uuid().equals(currentPack.uuid())) {
                fetchLeft.merge(t.item(), t.count(), Integer::sum);
            }
        }
        fetches.removeIf(t -> t.pack().uuid().equals(currentPack.uuid()));
        if (mc.screen != null) {
            mc.player.closeContainer(); // leave the crafting screen; the server needs the backpack menu on top
        }
        feedback.accept(Component.translatable("craftchain.msg.fetching", describe(fetchLeft), currentPack.describe()));
        if (!BackpackSupport.open(currentPack)) {
            feedback.accept(Component.translatable("craftchain.msg.backpack_open_failed", currentPack.describe()));
            reset();
            return;
        }
        timeout = OPEN_TIMEOUT;
        wait = 2;
        phase = Phase.FETCH_WAIT;
    }

    private void fetchWait(Minecraft mc, AbstractContainerMenu menu) {
        if (BackpackSupport.isBackpackMenu(menu) && mc.screen instanceof AbstractContainerScreen<?>) {
            wait = 2; // let the server's slot contents arrive
            phase = Phase.FETCH_PULL;
            return;
        }
        if (--timeout <= 0) {
            feedback.accept(Component.translatable("craftchain.msg.backpack_open_failed", currentPack.describe()));
            reset();
        }
    }

    private void fetchPull(Minecraft mc, AbstractContainerMenu menu) {
        int clicks = ClientConfig.clicksPerTick();
        while (clicks-- > 0) {
            Map.Entry<Item, Integer> next = null;
            for (Map.Entry<Item, Integer> e : fetchLeft.entrySet()) {
                if (e.getValue() > 0) {
                    next = e;
                    break;
                }
            }
            if (next == null) {
                phase = Phase.FETCH_CLOSE;
                return;
            }
            Slot source = null;
            for (Slot slot : menu.slots) {
                if (!(slot.container instanceof Inventory) && slot.hasItem() && slot.getItem().getItem() == next.getKey()) {
                    source = slot;
                    break;
                }
            }
            if (source == null) {
                feedback.accept(Component.translatable("craftchain.msg.backpack_missing_item",
                        new ItemStack(next.getKey()).getHoverName(), currentPack.describe()));
                reset();
                return;
            }
            int before = countInPlayerInventory(mc, next.getKey());
            mc.gameMode.handleInventoryMouseClick(menu.containerId, source.index, 0, ClickType.QUICK_MOVE, mc.player);
            int moved = countInPlayerInventory(mc, next.getKey()) - before;
            if (moved <= 0) {
                feedback.accept(Component.translatable("craftchain.msg.inventory_full"));
                reset();
                return;
            }
            next.setValue(next.getValue() - moved);
        }
    }

    private void fetchClose(Minecraft mc) {
        mc.player.closeContainer();
        wait = 2;
        phase = fetches.isEmpty() ? Phase.REOPEN : Phase.FETCH_OPEN;
    }

    private void reopen(Minecraft mc) {
        String how = CraftingReopener.reopen(gridNeeded, table);
        if (how == null) {
            feedback.accept(Component.translatable("craftchain.msg.reopen_failed"));
            reset();
            return;
        }
        feedback.accept(Component.translatable("craftchain.msg.reopening", how));
        timeout = OPEN_TIMEOUT;
        wait = 2;
        phase = Phase.REOPEN_WAIT;
    }

    private void reopenWait(Minecraft mc, AbstractContainerMenu menu) {
        GridLayout l = GridLayout.of(menu);
        if (l != null && l.gridSize() >= gridNeeded && mc.screen instanceof AbstractContainerScreen<?>) {
            layout = l;
            containerId = menu.containerId;
            wait = 2;
            phase = Phase.PREPARE;
            return;
        }
        if (--timeout <= 0) {
            feedback.accept(Component.translatable("craftchain.msg.reopen_timeout"));
            reset();
        }
    }

    private static int countInPlayerInventory(Minecraft mc, Item item) {
        int n = 0;
        for (ItemStack s : mc.player.getInventory().items) {
            if (!s.isEmpty() && s.getItem() == item) {
                n += s.getCount();
            }
        }
        return n;
    }

    private static String describe(Map<Item, Integer> items) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<Item, Integer> e : items.entrySet()) {
            if (sb.length() > 0) {
                sb.append(", ");
            }
            sb.append(e.getValue()).append("x ").append(new ItemStack(e.getKey()).getHoverName().getString());
        }
        return sb.toString();
    }

    // ---- crafting ------------------------------------------------------------------------

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
                click(mc, target, 0, ClickType.PICKUP);
            } else {
                click(mc, target, 1, ClickType.PICKUP);
            }
        }
    }

    private void craft(Minecraft mc, AbstractContainerMenu menu) {
        if (menu.getSlot(layout.resultSlot()).getItem().isEmpty()) {
            // The result slot is only ever filled by the server, so seeing an item here means the
            // server has caught up with every click we sent. That round trip is the natural brake.
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
