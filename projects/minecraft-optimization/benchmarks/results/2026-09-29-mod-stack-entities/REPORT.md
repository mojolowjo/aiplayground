# Benchmark report: 2026-09-29-mod-stack-entities

- Minecraft 26.3, Java 25.0.4.1+1-1-24.04.4-Ubuntu (Ubuntu)
- 4 CPUs, 4096 MB max heap, GC: G1 Young Generation, G1 Concurrent GC, G1 Old Generation
- Baseline for comparisons: `lithium`
- MSPT = milliseconds of work per server tick (lower is better; 50 is the limit).
  Numbers are the average over runs, with the lowest and highest run in brackets.

## Startup

Seconds from launching Java to the server being ready, including creating a fresh
world. Averaged over every run of every scenario.

| Stack | Runs | Launch to ready (s) |
|---|---|---|
| `lithium` | 6 | 20.6 (19.7–22.9) |
| `lithium-ferrite` | 6 | 21.2 (20.2–22.7) |
| `lithium-ferrite-c2me-lux` | 6 | 19.8 (19.2–20.6) |
| `lithium-ferrite-moonrise` | 6 | 20.4 (19.5–21.3) |

## villagers

300 villagers in one-block trading cells, each beside a workstation.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `lithium` | 3 | 15.54 (13.39–16.66) | 13.83 (12.24–14.98) | 24.68 (18.96–30.45) | 33.15 (22.31–41.45) | 176.62 (44.69–263.57) | 193 (0–380) |  |
| `lithium-ferrite` | 3 | 14.55 (12.72–15.84) | 13.24 (11.71–14.78) | 21.19 (18.36–22.95) | 31.43 (22.29–38.91) | 60.08 (33.27–83.97) | 17 (0–51) | -6.4% |
| `lithium-ferrite-c2me-lux` | 3 | 15.30 (14.20–16.36) | 13.31 (13.05–13.70) | 26.05 (20.07–33.60) | 37.03 (24.03–45.51) | 118.73 (41.36–173.08) | 91 (0–143) | -1.6% |
| `lithium-ferrite-moonrise` | 3 | 22.90 (22.09–23.50) | 21.21 (20.78–21.95) | 32.79 (30.77–34.61) | 46.55 (44.58–49.80) | 116.64 (66.56–208.67) | 92 (20–209) | +47.3% |

| Stack | villagersAtEnd | heap after GC (MB) |
|---|---|---|
| `lithium` | 300.00 (300.00–300.00) | 171.00 (171.00–171.00) |
| `lithium-ferrite` | 300.00 (300.00–300.00) | 163.00 (163.00–163.00) |
| `lithium-ferrite-c2me-lux` | 300.00 (300.00–300.00) | 177.00 (176.00–179.00) |
| `lithium-ferrite-moonrise` | 300.00 (300.00–300.00) | 250.00 (250.00–250.00) |

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.entity.ai.Brain.startEachNonRunningBehavior(ServerLevel, LivingEntity)                                                          126   8.36%
net.minecraft.network.syncher.SynchedEntityData.getItem(EntityDataAccessor)                                                                         118   7.82%
java.util.HashMap.getNode(Object)                                                                                                                   116   7.69%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                                86   5.70%
java.util.stream.ReferencePipeline$2$1.accept(Object)                                                                                                75   4.97%
net.minecraft.world.entity.ai.behavior.declarative.BehaviorBuilder$PureMemory$1.tryTrigger(ServerLevel, LivingEntity, long)                          60   3.98%
net.minecraft.world.entity.ai.behavior.SetLookAndInteract.lambda$create$3(LivingEntity, int, EntityType, LivingEntity)                               35   2.32%
java.util.ArrayList.forEach(Consumer)                                                                                                                32   2.12%
it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap.getInt(Object)                                                                                   32   2.12%
java.util.stream.ReferencePipeline$3$1.accept(Object)                                                                                                30   1.99%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap$1.forEach(Consumer)                                                                        26   1.72%
net.minecraft.world.entity.ai.behavior.GateBehavior.doStop(ServerLevel, LivingEntity, long)                                                          25   1.66%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.entity.ai.Brain.startEachNonRunningBehavior(ServerLevel, LivingEntity)                                                          133   9.29%
java.util.HashMap.getNode(Object)                                                                                                                   110   7.69%
net.minecraft.network.syncher.SynchedEntityData.getItem(EntityDataAccessor)                                                                         101   7.06%
java.util.stream.ReferencePipeline$2$1.accept(Object)                                                                                                83   5.80%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                                64   4.47%
net.minecraft.world.entity.ai.behavior.declarative.BehaviorBuilder$PureMemory$1.tryTrigger(ServerLevel, LivingEntity, long)                          50   3.49%
net.minecraft.world.entity.ai.behavior.SetLookAndInteract.lambda$create$3(LivingEntity, int, EntityType, LivingEntity)                               46   3.21%
it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap.getInt(Object)                                                                                   33   2.31%
java.util.Comparator.lambda$comparingDouble$8dcf42ea$1(ToDoubleFunction, Object, Object)                                                             31   2.17%
net.minecraft.world.entity.ai.Brain.tickSensors(ServerLevel, LivingEntity)                                                                           27   1.89%
java.util.stream.AbstractPipeline.copyIntoWithCancel(Sink, Spliterator)                                                                              26   1.82%
java.util.ArrayList.forEach(Consumer)                                                                                                                25   1.75%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-c2me-lux</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                               169  10.83%
net.minecraft.network.syncher.SynchedEntityData.getItem(EntityDataAccessor)                                                                         127   8.14%
net.minecraft.world.entity.ai.Brain.startEachNonRunningBehavior(ServerLevel, LivingEntity)                                                          111   7.11%
java.util.stream.ReferencePipeline$2$1.accept(Object)                                                                                                80   5.12%
net.minecraft.world.entity.ai.behavior.declarative.BehaviorBuilder$PureMemory$1.tryTrigger(ServerLevel, LivingEntity, long)                          56   3.59%
net.minecraft.world.entity.ai.behavior.SetLookAndInteract.lambda$create$3(LivingEntity, int, EntityType, LivingEntity)                               52   3.33%
it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap.getInt(Object)                                                                                   32   2.05%
java.util.ArrayList$ArrayListSpliterator.forEachRemaining(Consumer)                                                                                  31   1.99%
java.util.stream.ReferencePipeline$3$1.accept(Object)                                                                                                28   1.79%
net.minecraft.world.entity.ai.Brain.tickSensors(ServerLevel, LivingEntity)                                                                           27   1.73%
net.minecraft.world.entity.ai.sensing.NearestLivingEntitySensor$$Lambda.0x00000000853a4960.applyAsDouble(Object)                                     27   1.73%
java.util.Collection.removeIf(Predicate)                                                                                                             26   1.67%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-moonrise</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
ca.spottedleaf.moonrise.patches.poi_lookup.PoiAccess.findNearestPoiRecords(...)                                                                     283  10.68%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                               268  10.11%
it.unimi.dsi.fastutil.longs.LongOpenHashSet.add(long)                                                                                               230   8.68%
net.minecraft.world.entity.ai.Brain.startEachNonRunningBehavior(ServerLevel, LivingEntity)                                                          149   5.62%
net.minecraft.world.entity.Entity.isRemoved()                                                                                                       132   4.98%
java.util.HashMap$HashIterator.<init>(HashMap)                                                                                                       98   3.70%
it.unimi.dsi.fastutil.longs.LongOpenHashSet.rehash(int)                                                                                              95   3.58%
it.unimi.dsi.fastutil.longs.LongArrayFIFOQueue.enqueue(long)                                                                                         83   3.13%
net.minecraft.world.entity.ai.behavior.declarative.BehaviorBuilder$PureMemory$1.tryTrigger(ServerLevel, LivingEntity, long)                          73   2.75%
net.minecraft.world.entity.ai.behavior.SetLookAndInteract.lambda$create$3(LivingEntity, int, EntityType, LivingEntity)                               68   2.57%
java.util.stream.ReferencePipeline$2$1.accept(Object)                                                                                                64   2.41%
java.util.ArrayList.grow(int)                                                                                                                        42   1.58%
```

</details>

## items

1200 item entities of different types on a 16x16 floor.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `lithium` | 3 | 5.07 (4.51–6.17) | 4.32 (3.85–5.19) | 8.59 (6.96–10.82) | 14.74 (9.80–24.01) | 88.09 (15.24–204.41) | 75 (0–186) |  |
| `lithium-ferrite` | 3 | 5.73 (5.30–6.32) | 4.80 (4.34–5.21) | 10.45 (9.42–12.14) | 17.43 (11.97–26.34) | 118.06 (72.95–193.50) | 109 (66–179) | +13.0% |
| `lithium-ferrite-c2me-lux` | 3 | 5.34 (4.53–6.58) | 4.44 (4.05–4.98) | 9.29 (6.54–14.07) | 16.67 (8.11–30.42) | 137.73 (56.88–293.57) | 152 (51–348) | +5.2% |
| `lithium-ferrite-moonrise` | 3 | 4.23 (4.18–4.31) | 3.80 (3.75–3.87) | 6.33 (6.03–6.55) | 8.83 (7.95–9.30) | 13.25 (11.81–15.69) | 17 (0–26) | -16.6% |

| Stack | itemsAtEnd | heap after GC (MB) |
|---|---|---|
| `lithium` | 1200.00 (1200.00–1200.00) | 156.67 (156.00–157.00) |
| `lithium-ferrite` | 1200.00 (1200.00–1200.00) | 148.00 (148.00–148.00) |
| `lithium-ferrite-c2me-lux` | 1200.00 (1200.00–1200.00) | 160.67 (160.00–162.00) |
| `lithium-ferrite-moonrise` | 1200.00 (1200.00–1200.00) | 234.33 (234.00–235.00) |

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.get(long)                                                                                           70  10.85%
net.minecraft.world.entity.item.ItemEntity.tick()                                                                                                    45   6.98%
net.minecraft.server.level.ServerChunkCache.getChunk(int, int, ChunkStatus, boolean)                                                                 40   6.20%
net.minecraft.server.level.ServerEntity.sendChanges()                                                                                                36   5.58%
net.minecraft.world.level.entity.EntitySectionStorage.forEachAccessibleNonEmptySection(AABB, AbortableIterationConsumer)                             35   5.43%
net.minecraft.world.entity.Entity.tick()                                                                                                             27   4.19%
net.caffeinemc.mods.lithium.common.entity.movement.ChunkAwareBlockCollisionSweeperVoxelShape.<init>(Level, Entity, AABB)                             22   3.41%
net.minecraft.world.level.entity.EntitySectionStorage$Anonymous$8bd463eeb1493ce79f3e2caef1941c86.computeNext()                                       21   3.26%
net.caffeinemc.mods.lithium.common.entity.movement.ChunkAwareBlockCollisionSweeper.<init>(Level, Entity, AABB, boolean)                              20   3.10%
net.minecraft.world.entity.Entity$$Lambda.0x00000000382577c8.visit(BlockPos, int)                                                                    19   2.95%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                               18   2.79%
net.minecraft.world.phys.shapes.Shapes.create(double, double, double, double, double, double)                                                        16   2.48%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.caffeinemc.mods.lithium.common.entity.movement.ChunkAwareBlockCollisionSweeperVoxelShape.<init>(Level, Entity, AABB)                             76  11.09%
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.get(long)                                                                                           75  10.95%
net.minecraft.world.level.BlockGetter.forEachBlockIntersectedBetween(Vec3, Vec3, AABB, BlockGetter$BlockStepVisitor)                                 67   9.78%
net.minecraft.world.phys.shapes.Shapes.create(double, double, double, double, double, double)                                                        37   5.40%
net.minecraft.server.level.ServerEntity.sendChanges()                                                                                                34   4.96%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                               34   4.96%
net.minecraft.world.entity.Entity.tick()                                                                                                             26   3.80%
net.minecraft.world.entity.Entity.getOnPos(float)                                                                                                    22   3.21%
net.minecraft.world.entity.Entity.lithium$CollideMovement(Entity, Vec3, AABB, Level, List, LocalBooleanRef)                                          20   2.92%
net.minecraft.server.level.ServerChunkCache.getChunk(int, int, ChunkStatus, boolean)                                                                 20   2.92%
net.minecraft.world.level.entity.EntitySectionStorage.handler$bcf000$lithium$forEachInBox(...)                                                       20   2.92%
net.minecraft.world.level.entity.EntitySectionStorage$Anonymous$8bd463eeb1493ce79f3e2caef1941c86.computeNext()                                       18   2.63%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-c2me-lux</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.get(long)                                                                                           60   9.22%
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.containsKey(long)                                                                                   47   7.22%
net.minecraft.server.level.ServerChunkCache.getChunk$mixinextras$wrapped$94(int, int, ChunkStatus, boolean)                                          42   6.45%
net.minecraft.world.entity.Entity.tick()                                                                                                             37   5.68%
net.minecraft.world.entity.item.ItemEntity.tick()                                                                                                    36   5.53%
net.minecraft.server.level.ServerEntity.sendChanges()                                                                                                31   4.76%
net.minecraft.world.level.entity.EntitySectionStorage.forEachAccessibleNonEmptySection(AABB, AbortableIterationConsumer)                             30   4.61%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                               30   4.61%
net.caffeinemc.mods.lithium.common.entity.movement.ChunkAwareBlockCollisionSweeperVoxelShape.<init>(Level, Entity, AABB)                             28   4.30%
net.minecraft.world.entity.Entity$$Lambda.0x0000000022340618.visit(BlockPos, int)                                                                    18   2.76%
net.minecraft.world.entity.Entity.updateFluidInteraction()                                                                                           18   2.76%
net.minecraft.world.phys.shapes.Shapes.create(double, double, double, double, double, double)                                                        17   2.61%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-moonrise</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.server.level.ChunkMap.redirect$bha000$moonrise$newTrackerTick(Iterator)                                                                41   9.58%
net.minecraft.server.level.ServerEntity.sendChanges()                                                                                                32   7.48%
net.minecraft.world.entity.Entity.tick()                                                                                                             27   6.31%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                               27   6.31%
net.minecraft.world.entity.Entity.getOnPos(float)                                                                                                    25   5.84%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                                22   5.14%
net.minecraft.world.level.entity.EntityTickList.md96b89e$moonrise$forEach$0(Consumer)                                                                21   4.91%
net.minecraft.world.level.block.state.BlockBehaviour$BlockStateBase.getCollisionShape(BlockGetter, BlockPos, CollisionContext)                       17   3.97%
net.minecraft.server.level.ServerLevel.tickNonPassenger(Entity)                                                                                      17   3.97%
ca.spottedleaf.moonrise.libs.ca.spottedleaf.concurrentutil.map.concurrent.longs.ConcurrentChainedLong2ReferenceHashTable.getNode(long)               12   2.80%
net.minecraft.world.level.Level.noCollision(Entity, AABB)                                                                                            11   2.57%
it.unimi.dsi.fastutil.objects.Reference2ObjectArrayMap$ValuesCollection.forEach(Consumer)                                                            11   2.57%
```

</details>
