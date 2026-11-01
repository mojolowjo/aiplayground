package com.mojolowjo.craftchain.backpack;

import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import top.theillusivec4.curios.api.CuriosApi;
import top.theillusivec4.curios.api.type.inventory.ICurioStacksHandler;
import top.theillusivec4.curios.api.type.inventory.IDynamicStackHandler;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

/**
 * The only class that touches the Curios API. It is loaded only when Curios is present
 * (see the ModList check before every call), so a pack without Curios never trips a missing class.
 */
public final class CuriosAccess {
    public record Found(ItemStack stack, String identifier, int slot) {}

    private CuriosAccess() {}

    /** Every equipped curio that matches, with its slot identifier ("back") and index. */
    public static List<Found> findBackpacks(Player player, Predicate<ItemStack> isBackpack) {
        List<Found> out = new ArrayList<>();
        CuriosApi.getCuriosInventory(player).ifPresent(inv -> {
            for (Map.Entry<String, ICurioStacksHandler> e : inv.getCurios().entrySet()) {
                IDynamicStackHandler stacks = e.getValue().getStacks();
                for (int i = 0; i < stacks.getSlots(); i++) {
                    ItemStack s = stacks.getStackInSlot(i);
                    if (isBackpack.test(s)) {
                        out.add(new Found(s, e.getKey(), i));
                    }
                }
            }
        });
        return out;
    }
}
