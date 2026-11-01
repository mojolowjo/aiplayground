package com.mojolowjo.craftchain.backpack;

import com.mojolowjo.craftchain.planning.ItemCounts;
import net.minecraft.world.item.ItemStack;

import java.util.UUID;

/**
 * One backpack the player carries and what we know is inside it.
 *
 * @param uuid          the backpack's contents id (from its NBT)
 * @param stack         the backpack item itself
 * @param inventorySlot index in the player's inventory, or -1 when it sits in a Curios slot
 * @param curiosId      the Curios slot identifier ("back"), or "" for inventory backpacks
 * @param curiosSlot    index within that Curios slot type
 * @param contents      item counts inside, as last reported by the server
 */
public record BackpackInfo(UUID uuid, ItemStack stack, int inventorySlot, String curiosId, int curiosSlot, ItemCounts contents) {
    public boolean inCurios() {
        return inventorySlot < 0;
    }

    public String describe() {
        return stack.getHoverName().getString() + (inCurios() ? " (" + curiosId + ")" : " (slot " + inventorySlot + ")");
    }
}
