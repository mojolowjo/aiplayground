package com.mojolowjo.craftchain.planning;

import com.mojolowjo.craftchain.backpack.BackpackInfo;
import com.mojolowjo.craftchain.backpack.BackpackSupport;
import net.minecraft.client.Minecraft;
import net.minecraft.world.item.Item;

import java.util.List;
import java.util.Map;

/**
 * One picture of everything the player owns right now: the inventory plus every backpack we have
 * heard about. {@code inventory} is what crafting can use directly; {@code total} is what planning
 * may count on, with the difference fetched from backpacks first.
 */
public record Stock(ItemCounts inventory, ItemCounts total, List<BackpackInfo> backpacks) {

    public static Stock snapshot() {
        Minecraft mc = Minecraft.getInstance();
        ItemCounts inventory = mc.player == null ? new ItemCounts() : ItemCounts.ofPlayerInventory(mc.player.getInventory());
        ItemCounts total = inventory.copy();
        for (Map.Entry<Item, Integer> e : BackpackSupport.cachedContents().asMap().entrySet()) {
            total.add(e.getKey(), e.getValue());
        }
        return new Stock(inventory, total, BackpackSupport.backpacks());
    }

    /** A key that changes whenever the counts change; used to know when pins need recomputing. */
    public int key() {
        return total.asMap().hashCode() * 31 + inventory.asMap().hashCode();
    }

    /** How many of an item or any of its alternatives we own in total. */
    public int totalOfAny(Item item, Item[] alternatives) {
        if (alternatives == null) {
            return total.get(item);
        }
        int n = 0;
        for (Item alt : alternatives) {
            n += total.get(alt);
        }
        return n;
    }
}
