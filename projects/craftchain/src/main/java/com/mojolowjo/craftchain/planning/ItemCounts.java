package com.mojolowjo.craftchain.planning;

import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

import java.util.LinkedHashMap;
import java.util.Map;

/** A mutable bag of item -> count. Used as the planner's virtual inventory and for the result maps. */
public final class ItemCounts {
    private final Map<Item, Integer> counts = new LinkedHashMap<>();

    public static ItemCounts ofPlayerInventory(Inventory inventory) {
        ItemCounts c = new ItemCounts();
        for (ItemStack stack : inventory.items) { // main 27 + hotbar 9; armor and offhand left alone
            if (!stack.isEmpty()) {
                c.add(stack.getItem(), stack.getCount());
            }
        }
        return c;
    }

    public ItemCounts copy() {
        ItemCounts c = new ItemCounts();
        c.counts.putAll(counts);
        return c;
    }

    public int get(Item item) {
        return counts.getOrDefault(item, 0);
    }

    public void add(Item item, int n) {
        if (n <= 0) {
            return;
        }
        counts.merge(item, n, Integer::sum);
    }

    /** Removes up to n and returns how many were actually removed. */
    public int take(Item item, int n) {
        int have = get(item);
        int taken = Math.min(have, n);
        if (taken == have) {
            counts.remove(item);
        } else {
            counts.put(item, have - taken);
        }
        return taken;
    }

    public boolean isEmpty() {
        return counts.isEmpty();
    }

    public int total() {
        int t = 0;
        for (int v : counts.values()) {
            t += v;
        }
        return t;
    }

    public Map<Item, Integer> asMap() {
        return counts;
    }

    @Override
    public String toString() {
        return counts.toString();
    }
}
