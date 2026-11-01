package com.mojolowjo.craftchain;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojolowjo.craftchain.backpack.BackpackInfo;
import com.mojolowjo.craftchain.backpack.BackpackSupport;
import com.mojolowjo.craftchain.backpack.CraftingReopener;
import com.mojolowjo.craftchain.execution.CraftExecutor;
import com.mojolowjo.craftchain.execution.GridLayout;
import com.mojolowjo.craftchain.jei.JeiHover;
import com.mojolowjo.craftchain.pins.PinnedList;
import com.mojolowjo.craftchain.pins.PinnedOverlay;
import com.mojolowjo.craftchain.planning.CraftPlan;
import com.mojolowjo.craftchain.planning.CraftPlanner;
import com.mojolowjo.craftchain.planning.ItemCounts;
import com.mojolowjo.craftchain.planning.RecipeIndex;
import com.mojolowjo.craftchain.planning.Stock;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraftforge.client.event.ClientPlayerNetworkEvent;
import net.minecraftforge.client.event.RecipesUpdatedEvent;
import net.minecraftforge.client.event.RegisterClientCommandsEvent;
import net.minecraftforge.client.event.ScreenEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.eventbus.api.EventPriority;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Forge event glue: keys, scroll, ticks, screen rendering, recipe reloads, and the /craftchain client command. */
public final class ClientEvents {
    private static final String PREFIX = "[CraftChain] ";

    /** A craft confirmed from JEI's recipe screen; it runs once a container screen is back in front. */
    private ItemStack pendingTarget;
    private int pendingCount;

    public ClientEvents() {
        CraftExecutor.get().setFeedback(ClientEvents::say);
    }

    // ---- input -----------------------------------------------------------------------------

    // HIGH priority so we see the key before JEI's own handler (which runs at NORMAL).
    @SubscribeEvent(priority = EventPriority.HIGH)
    public void onKey(ScreenEvent.KeyPressed.Pre event) {
        Screen screen = event.getScreen();
        InputConstants.Key key = InputConstants.getKey(event.getKeyCode(), event.getScanCode());
        CraftPrompt prompt = CraftPrompt.get();

        if (event.getKeyCode() == GLFW.GLFW_KEY_ESCAPE) {
            if (prompt.isActive()) {
                prompt.close();
                event.setCanceled(true);
                return;
            }
            if (CraftExecutor.get().isRunning()) {
                CraftExecutor.get().cancel("craftchain.msg.cancelled");
                event.setCanceled(true);
                return;
            }
        }
        if (Keybinds.CANCEL.isActiveAndMatches(key) && CraftExecutor.get().isRunning()) {
            CraftExecutor.get().cancel("craftchain.msg.cancelled");
            event.setCanceled(true);
            return;
        }
        if (JeiHover.typingInTextField(screen)) {
            return;
        }
        boolean craft = Keybinds.CRAFT.isActiveAndMatches(key);
        boolean pin = Keybinds.PIN.isActiveAndMatches(key);
        if (!craft && !pin) {
            return;
        }

        // Second G: confirm the prompt.
        if (craft && prompt.isActive()) {
            event.setCanceled(true);
            ItemStack target = prompt.target();
            int amount = prompt.amount();
            prompt.close();
            if (screen instanceof AbstractContainerScreen<?>) {
                requestCraft(target, amount);
            } else {
                pendingTarget = target;
                pendingCount = amount;
                screen.onClose();
            }
            return;
        }

        Optional<ItemStack> hovered = JeiHover.itemUnderMouse(screen);
        if (hovered.isEmpty()) {
            return;
        }
        event.setCanceled(true);
        ItemStack stack = hovered.get();
        int stackSize = stack.getMaxStackSize();

        if (pin) {
            if (Screen.hasControlDown()) {
                if (PinnedList.get().remove(stack.getItem())) {
                    say(Component.translatable("craftchain.msg.unpinned", stack.getHoverName()));
                }
            } else {
                int n = Screen.hasShiftDown() ? stackSize : 1;
                PinnedList.get().add(stack.getItem(), n);
                say(Component.translatable("craftchain.msg.pinned", n, stack.getHoverName()));
                BackpackSupport.requestNow();
            }
            return;
        }

        // First G: open the amount prompt.
        prompt.open(screen, stack, Screen.hasShiftDown() ? stackSize : 1);
        BackpackSupport.requestNow();
    }

    @SubscribeEvent(priority = EventPriority.HIGH)
    public void onScroll(ScreenEvent.MouseScrolled.Pre event) {
        CraftPrompt prompt = CraftPrompt.get();
        if (!prompt.isActive()) {
            return;
        }
        int step = Screen.hasShiftDown() ? 16 : 1;
        prompt.adjust(event.getScrollDelta() > 0 ? step : -step);
        event.setCanceled(true); // keep JEI's list from scrolling underneath
    }

    @SubscribeEvent(priority = EventPriority.HIGH)
    public void onClick(ScreenEvent.MouseButtonPressed.Pre event) {
        if (CraftPrompt.get().isActive()) {
            CraftPrompt.get().close(); // clicking anywhere cancels the prompt; the click itself goes through
        }
    }

    @SubscribeEvent
    public void onScreenRender(ScreenEvent.Render.Post event) {
        PinnedOverlay.draw(event.getGuiGraphics());
        CraftPrompt.get().render(event.getScreen(), event.getGuiGraphics(), event.getMouseX(), event.getMouseY());
    }

    // ---- ticks and world -------------------------------------------------------------------

    @SubscribeEvent
    public void onTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        if (pendingTarget != null) {
            if (mc.screen instanceof AbstractContainerScreen<?>) {
                ItemStack t = pendingTarget;
                pendingTarget = null;
                requestCraft(t, pendingCount);
            } else if (mc.screen == null) {
                pendingTarget = null;
                say(Component.translatable("craftchain.msg.open_inventory"));
            }
        }
        CraftExecutor.get().tick();
        if (mc.player != null) {
            BackpackSupport.tick();
        }
    }

    @SubscribeEvent
    public void onRecipesUpdated(RecipesUpdatedEvent event) {
        RecipeIndex.rebuild(event.getRecipeManager());
        PinnedList.get().invalidate();
    }

    @SubscribeEvent
    public void onLogout(ClientPlayerNetworkEvent.LoggingOut event) {
        RecipeIndex.clear();
        pendingTarget = null;
        CraftPrompt.get().close();
    }

    @SubscribeEvent
    public void onRegisterCommands(RegisterClientCommandsEvent event) {
        CommandDispatcher<CommandSourceStack> d = event.getDispatcher();
        d.register(Commands.literal("craftchain")
                .then(Commands.literal("clear").executes(ctx -> {
                    PinnedList.get().clear();
                    say(Component.translatable("craftchain.msg.cleared"));
                    return 1;
                }))
                .then(Commands.literal("cancel").executes(ctx -> {
                    CraftExecutor.get().cancel("craftchain.msg.cancelled");
                    return 1;
                }))
                .then(Commands.literal("status").executes(ctx -> {
                    BackpackSupport.requestNow(); // scan now; the server's answer shows up on the next status
                    say(Component.literal("backpacks " + BackpackSupport.describe()
                            + ", running: " + CraftExecutor.get().isRunning()
                            + ", pinned: " + PinnedList.get().entries().size()));
                    return 1;
                }))
                .then(Commands.literal("hud")
                        .then(Commands.argument("x", IntegerArgumentType.integer(0, 10000))
                                .then(Commands.argument("y", IntegerArgumentType.integer(0, 10000)).executes(ctx -> {
                                    int x = IntegerArgumentType.getInteger(ctx, "x");
                                    int y = IntegerArgumentType.getInteger(ctx, "y");
                                    ClientConfig.HUD_X.set(x);
                                    ClientConfig.HUD_Y.set(y);
                                    ClientConfig.SPEC.save();
                                    say(Component.translatable("craftchain.msg.hud_moved", x, y));
                                    return 1;
                                })))));
    }

    // ---- crafting --------------------------------------------------------------------------

    private static void requestCraft(ItemStack target, int count) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null) {
            return;
        }
        AbstractContainerMenu menu = mc.player.containerMenu;
        GridLayout layout = GridLayout.of(menu);
        if (layout == null) {
            say(Component.translatable("craftchain.msg.unsupported_menu"));
            return;
        }
        RecipeIndex index = RecipeIndex.get();
        if (index == null) {
            say(Component.translatable("craftchain.msg.no_recipes"));
            return;
        }
        Item item = target.getItem();
        Stock stock = Stock.snapshot();
        ItemCounts owned = stock.total().copy();
        owned.take(item, Integer.MAX_VALUE); // the player wants N new ones, whatever they already hold
        CraftPlan plan = new CraftPlanner(index, layout.gridSize(), stock.inventory()).plan(item, count, owned);

        if (plan.steps().isEmpty() && plan.missing().isEmpty()) {
            say(Component.translatable(plan.needsBigGrid() ? "craftchain.msg.needs_table" : "craftchain.msg.no_recipe",
                    target.getHoverName()));
            return;
        }
        if (!plan.missing().isEmpty()) {
            StringBuilder missing = new StringBuilder();
            for (Map.Entry<Item, Integer> e : plan.missing().asMap().entrySet()) {
                if (missing.length() > 0) {
                    missing.append(", ");
                }
                missing.append(e.getValue()).append("x ").append(new ItemStack(e.getKey()).getHoverName().getString());
            }
            say(Component.translatable("craftchain.msg.missing", missing.toString()));
            PinnedList.get().add(item, count);
            say(Component.translatable("craftchain.msg.auto_pinned", count, target.getHoverName()));
            return;
        }
        if (plan.needsBigGrid()) {
            say(Component.translatable("craftchain.msg.needs_table"));
            return;
        }
        int cap = ClientConfig.MAX_CRAFTS_PER_RUN.get();
        if (plan.totalCrafts() > cap) {
            say(Component.translatable("craftchain.msg.too_many_crafts", plan.totalCrafts(), cap));
            return;
        }

        // Whatever the plan uses beyond the inventory has to come out of a backpack first.
        List<CraftExecutor.FetchTask> fetches = new ArrayList<>();
        for (Map.Entry<Item, Integer> e : plan.used().asMap().entrySet()) {
            int need = e.getValue() - stock.inventory().get(e.getKey());
            for (BackpackInfo pack : stock.backpacks()) {
                if (need <= 0) {
                    break;
                }
                int inPack = pack.contents().get(e.getKey());
                if (inPack > 0) {
                    int take = Math.min(inPack, need);
                    fetches.add(new CraftExecutor.FetchTask(pack, e.getKey(), take));
                    need -= take;
                }
            }
            if (need > 0) {
                say(Component.translatable("craftchain.msg.ran_out", new ItemStack(e.getKey()).getHoverName()));
                return;
            }
        }
        if (!fetches.isEmpty() && !BackpackSupport.working()) {
            say(Component.translatable("craftchain.msg.in_backpack", "backpack hooks unavailable"));
            return;
        }
        say(Component.translatable("craftchain.msg.starting", count, target.getHoverName(), plan.steps().size(), plan.totalCrafts()));
        CraftExecutor.get().start(plan, menu, fetches, CraftingReopener.lookedAtTable());
    }

    static void say(Component message) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player != null && ClientConfig.CHAT_FEEDBACK.get()) {
            mc.player.displayClientMessage(Component.literal(PREFIX).append(message), false);
        }
    }
}
