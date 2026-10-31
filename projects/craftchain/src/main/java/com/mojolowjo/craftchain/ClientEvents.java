package com.mojolowjo.craftchain;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.brigadier.CommandDispatcher;
import com.mojolowjo.craftchain.backpack.BackpackSupport;
import com.mojolowjo.craftchain.execution.CraftExecutor;
import com.mojolowjo.craftchain.execution.GridLayout;
import com.mojolowjo.craftchain.jei.JeiHover;
import com.mojolowjo.craftchain.pins.PinnedList;
import com.mojolowjo.craftchain.planning.CraftPlan;
import com.mojolowjo.craftchain.planning.CraftPlanner;
import com.mojolowjo.craftchain.planning.ItemCounts;
import com.mojolowjo.craftchain.planning.RecipeIndex;
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

import java.util.Map;
import java.util.Optional;

/** Forge event glue: keys, ticks, recipe reloads, and the /craftchain client command. */
public final class ClientEvents {
    private static final String PREFIX = "[CraftChain] ";

    /** A craft requested from JEI's recipe screen; it runs once a container screen is back in front. */
    private ItemStack pendingTarget;
    private int pendingCount;

    public ClientEvents() {
        CraftExecutor.get().setFeedback(ClientEvents::say);
    }

    // HIGH priority so we see the key before JEI's own handler (which runs at NORMAL).
    @SubscribeEvent(priority = EventPriority.HIGH)
    public void onKey(ScreenEvent.KeyPressed.Pre event) {
        Screen screen = event.getScreen();
        InputConstants.Key key = InputConstants.getKey(event.getKeyCode(), event.getScanCode());

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
            }
            return;
        }

        int count = Screen.hasShiftDown() ? stackSize : 1;
        if (screen instanceof AbstractContainerScreen<?>) {
            requestCraft(stack, count);
        } else {
            // JEI's recipe screen (or another non-container screen): go back and craft when the container shows.
            pendingTarget = stack.copy();
            pendingCount = count;
            screen.onClose();
        }
    }

    @SubscribeEvent
    public void onTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) {
            return;
        }
        if (pendingTarget != null) {
            Minecraft mc = Minecraft.getInstance();
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
                    say(Component.literal("Sophisticated Backpacks: " + BackpackSupport.sophisticatedBackpacksLoaded()
                            + ", Curios: " + BackpackSupport.curiosLoaded()
                            + ", running: " + CraftExecutor.get().isRunning()));
                    return 1;
                })));
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
        ItemCounts inventory = ItemCounts.ofPlayerInventory(mc.player.getInventory());
        CraftPlan plan = new CraftPlanner(index, layout.gridSize()).plan(item, count, inventory);

        if (plan.steps().isEmpty()) {
            if (inventory.get(item) >= count) {
                say(Component.translatable("craftchain.msg.already_have", target.getHoverName()));
            } else if (plan.needsBigGrid()) {
                say(Component.translatable("craftchain.msg.needs_table"));
            } else {
                say(Component.translatable("craftchain.msg.no_recipe", target.getHoverName()));
            }
            return;
        }
        if (!plan.missing().isEmpty()) {
            StringBuilder sb = new StringBuilder();
            for (Map.Entry<Item, Integer> e : plan.missing().asMap().entrySet()) {
                if (sb.length() > 0) {
                    sb.append(", ");
                }
                sb.append(e.getValue()).append("x ").append(new ItemStack(e.getKey()).getHoverName().getString());
            }
            say(Component.translatable("craftchain.msg.missing", sb.toString()));
            if (BackpackSupport.sophisticatedBackpacksLoaded()) {
                say(Component.translatable("craftchain.msg.backpacks_todo"));
            }
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
        say(Component.translatable("craftchain.msg.starting", count, target.getHoverName(), plan.steps().size(), plan.totalCrafts()));
        CraftExecutor.get().start(plan, menu);
    }

    static void say(Component message) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player != null && ClientConfig.CHAT_FEEDBACK.get()) {
            mc.player.displayClientMessage(Component.literal(PREFIX).append(message), false);
        }
    }
}
