# Benchmark report: 2026-09-29-baseline-vs-lithium

- Minecraft 26.3, Java 25.0.4.1+1-1-24.04.4-Ubuntu (Ubuntu)
- 4 CPUs, 4096 MB max heap, GC: G1 Young Generation, G1 Concurrent GC, G1 Old Generation
- Baseline for comparisons: `baseline`
- MSPT = milliseconds of work per server tick (lower is better; 50 is the limit).
  Numbers are the average over runs, with the lowest and highest run in brackets.

## idle

An empty platform: the cost of the server doing nothing.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `baseline` | 3 | 0.34 (0.33–0.35) | 0.30 (0.30–0.31) | 0.52 (0.50–0.54) | 0.93 (0.83–1.09) | 2.93 (2.13–3.74) | 0 (0–0) |  |
| `lithium` | 3 | 0.34 (0.33–0.34) | 0.30 (0.29–0.30) | 0.51 (0.48–0.53) | 0.80 (0.73–0.85) | 4.02 (2.79–5.04) | 0 (0–0) | -1.3% |

<details><summary>Hot methods: <code>baseline</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.material.FluidState.isRandomlyTicking()                                                                                     3   8.11%
net.minecraft.world.level.chunk.LevelChunkSection.isRandomlyTickingFluids()                                                                           2   5.41%
net.minecraft.world.level.TicketStorage.removeTicketIf(TicketStorage$TicketPredicate, Long2ObjectOpenHashMap)                                         2   5.41%
net.minecraft.server.level.ServerLevel.tick(BooleanSupplier)                                                                                          2   5.41%
net.minecraft.server.level.ChunkHolder.getTickingChunk()                                                                                              1   2.70%
net.minecraft.world.level.chunk.DataLayer.get(int)                                                                                                    1   2.70%
net.minecraft.server.level.ServerChunkCache.lambda$tickChunks$0(int, LevelChunk)                                                                      1   2.70%
it.unimi.dsi.fastutil.longs.LongOpenHashSet.contains(long)                                                                                            1   2.70%
it.unimi.dsi.fastutil.longs.Long2LongOpenHashMap$FastEntryIterator.next()                                                                             1   2.70%
it.unimi.dsi.fastutil.ints.Int2ObjectOpenHashMap$MapIterator.<init>(Int2ObjectOpenHashMap)                                                            1   2.70%
it.unimi.dsi.fastutil.longs.Long2ObjectOpenHashMap.get(long)                                                                                          1   2.70%
net.minecraft.world.attribute.EnvironmentAttributeSystem$ValueSampler.computeValueNotPositional()                                                     1   2.70%
```

</details>

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.chunk.LevelChunkSection.isRandomlyTickingFluids()                                                                           3   6.12%
net.minecraft.server.level.ServerLevel.tick(BooleanSupplier)                                                                                          3   6.12%
java.lang.invoke.DelegatingMethodHandle$Holder.delegate(Object, Object, Object)                                                                       2   4.08%
net.minecraft.server.level.ChunkHolder.getTickingChunk()                                                                                              2   4.08%
net.minecraft.world.level.TicketStorage$$Lambda.0x000000008125ec90.test(Ticket, long)                                                                 1   2.04%
java.lang.invoke.DirectMethodHandle.allocateInstance(Object)                                                                                          1   2.04%
net.minecraft.world.level.block.state.BlockBehaviour$BlockStateBase.randomTick(ServerLevel, BlockPos, RandomSource)                                   1   2.04%
it.unimi.dsi.fastutil.longs.Long2LongOpenHashMap$FastEntryIterator.next()                                                                             1   2.04%
net.minecraft.world.level.Level.tickBlockEntities()                                                                                                   1   2.04%
net.minecraft.world.TickRateManager.tick()                                                                                                            1   2.04%
net.minecraft.server.level.ServerChunkCache.lambda$tickChunks$0(int, LevelChunk)                                                                      1   2.04%
java.util.concurrent.ConcurrentHashMap.get(Object)                                                                                                    1   2.04%
```

</details>

## villagers

300 villagers in one-block trading cells, each beside a workstation.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `baseline` | 3 | 27.45 (25.61–30.78) | 24.14 (23.61–24.68) | 48.62 (38.40–68.63) | 59.85 (44.17–90.73) | 209.43 (60.48–290.57) | 211 (34–341) |  |
| `lithium` | 3 | 22.93 (17.35–27.11) | 17.50 (14.08–19.73) | 46.41 (37.02–53.77) | 58.10 (46.45–68.35) | 318.77 (285.29–344.50) | 293 (257–333) | -16.5% |

| Stack | villagersAtEnd |
|---|---|
| `baseline` | 300.00 (300.00–300.00) |
| `lithium` | 300.00 (300.00–300.00) |

<details><summary>Hot methods: <code>baseline</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
java.util.HashMap.getNode(Object)                                                                                                                   211   7.25%
it.unimi.dsi.fastutil.longs.Long2ObjectOpenHashMap.get(long)                                                                                        204   7.01%
net.minecraft.world.entity.ai.Brain.getRunningBehaviors()                                                                                           174   5.98%
net.minecraft.world.entity.Entity.isRemoved()                                                                                                       139   4.78%
java.util.HashMap$HashIterator.<init>(HashMap)                                                                                                      137   4.71%
net.minecraft.world.entity.ai.Brain.startEachNonRunningBehavior(ServerLevel, LivingEntity)                                                          128   4.40%
java.util.stream.ReferencePipeline$2$1.accept(Object)                                                                                               109   3.75%
java.util.HashMap$HashIterator.nextNode()                                                                                                           106   3.64%
java.util.HashMap.hash(Object)                                                                                                                       72   2.48%
java.util.HashMap$KeySet.iterator()                                                                                                                  72   2.48%
java.util.stream.ReferencePipeline$3$1.accept(Object)                                                                                                72   2.48%
net.minecraft.world.level.BlockCollisions.computeNext()                                                                                              62   2.13%
```

</details>

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                               448  14.69%
net.minecraft.network.syncher.SynchedEntityData.getItem(EntityDataAccessor)                                                                         223   7.31%
java.util.stream.AbstractPipeline.copyIntoWithCancel(Sink, Spliterator)                                                                             149   4.89%
net.minecraft.world.entity.ai.behavior.declarative.BehaviorBuilder$PureMemory$1.tryTrigger(ServerLevel, LivingEntity, long)                         144   4.72%
it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap.getInt(Object)                                                                                  123   4.03%
net.minecraft.world.phys.shapes.Shapes.create(AABB)                                                                                                  91   2.98%
net.minecraft.world.entity.ai.behavior.SetLookAndInteract.lambda$create$3(LivingEntity, int, EntityType, LivingEntity)                               79   2.59%
java.util.stream.ReferencePipeline$2$1.accept(Object)                                                                                                77   2.53%
net.minecraft.world.entity.ai.behavior.declarative.MemoryCondition$Present.createAccessor(Brain, Optional)                                           71   2.33%
net.minecraft.server.level.ServerChunkCache.getChunk(int, int, ChunkStatus, boolean)                                                                 70   2.30%
net.minecraft.world.entity.ai.behavior.GateBehavior.tickOrStop(ServerLevel, LivingEntity, long)                                                      59   1.94%
net.minecraft.world.entity.ai.behavior.declarative.MemoryCondition$Registered.createAccessor(Brain, Optional)                                        50   1.64%
```

</details>

## cramming

200 cows packed into an 8x8 pen.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `baseline` | 3 | 11.47 (7.69–13.73) | 8.73 (7.00–9.75) | 21.67 (10.94–27.72) | 27.31 (15.00–33.88) | 74.49 (40.43–96.29) | 62 (29–84) |  |
| `lithium` | 3 | 10.18 (9.02–11.91) | 8.83 (6.41–13.60) | 20.65 (18.88–23.12) | 26.71 (22.23–30.97) | 112.51 (33.20–257.46) | 81 (0–244) | -11.2% |

| Stack | cowsAtEnd |
|---|---|
| `baseline` | 200.00 (200.00–200.00) |
| `lithium` | 200.00 (200.00–200.00) |

<details><summary>Hot methods: <code>baseline</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.BlockCollisions.computeNext()                                                                                             104  12.75%
net.minecraft.util.AbortableIterationConsumer$$Lambda.0x000000003825e208.accept(Object)                                                              90  11.03%
net.minecraft.world.level.chunk.PalettedContainer.get(int)                                                                                           66   8.09%
java.util.ArrayList$Itr.next()                                                                                                                       20   2.45%
net.minecraft.server.level.ServerEntity.sendChanges()                                                                                                20   2.45%
java.util.ArrayList$Itr.hasNext()                                                                                                                    18   2.21%
com.google.common.collect.Iterators$1.hasNext()                                                                                                      17   2.08%
net.minecraft.world.entity.Entity.updateFluidInteraction()                                                                                           17   2.08%
net.minecraft.world.entity.Entity.push(Entity)                                                                                                       16   1.96%
it.unimi.dsi.fastutil.doubles.DoubleArrayList.getDouble(int)                                                                                         16   1.96%
java.util.ArrayList.addAll(Collection)                                                                                                               14   1.72%
net.minecraft.world.level.LevelReader.getChunk(int, int, ChunkStatus)                                                                                14   1.72%
```

</details>

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.caffeinemc.mods.lithium.common.entity.movement.ChunkAwareBlockCollisionSweeperVoxelShape.computeNext()                                           79   6.05%
net.minecraft.core.BlockPos.betweenCornersInDirection(int, int, int, int, int, int, Vec3)                                                            75   5.75%
java.util.stream.AbstractPipeline.copyIntoWithCancel(Sink, Spliterator)                                                                              60   4.60%
net.minecraft.world.entity.Entity.lithium$CollideMovement(Entity, Vec3, AABB, Level, List, LocalBooleanRef)                                          50   3.83%
net.minecraft.world.phys.shapes.Shapes.create(AABB)                                                                                                  48   3.68%
net.minecraft.world.phys.shapes.Shapes.create(double, double, double, double, double, double)                                                        42   3.22%
net.minecraft.world.entity.Entity.push(Entity)                                                                                                       41   3.14%
net.minecraft.world.entity.EntitySelector$$Lambda.0x000000009d2126b8.test(Object)                                                                    36   2.76%
net.minecraft.world.level.block.state.BlockBehaviour$BlockStateBase.getCollisionShape(BlockGetter, BlockPos, CollisionContext)                       32   2.45%
net.minecraft.world.phys.Vec3.add(double, double, double)                                                                                            29   2.22%
net.minecraft.world.entity.Entity.setPos(Vec3)                                                                                                       25   1.92%
net.minecraft.server.level.ServerChunkCache.getChunk(int, int, ChunkStatus, boolean)                                                                 24   1.84%
```

</details>

## items

1200 item entities of different types on a 16x16 floor.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `baseline` | 3 | 28.30 (23.98–30.68) | 21.62 (21.21–22.01) | 54.30 (37.66–65.19) | 70.53 (42.99–89.37) | 221.43 (175.54–285.41) | 202 (98–290) |  |
| `lithium` | 3 | 7.62 (5.82–8.91) | 5.53 (4.61–6.01) | 16.98 (9.64–20.89) | 23.61 (18.47–27.06) | 199.47 (90.02–285.66) | 255 (80–425) | -73.1% |

| Stack | itemsAtEnd |
|---|---|
| `baseline` | 1200.00 (1200.00–1200.00) |
| `lithium` | 1200.00 (1200.00–1200.00) |

<details><summary>Hot methods: <code>baseline</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.util.AbortableIterationConsumer$$Lambda.0x000000007924f4c0.accept(Object)                                                             992  36.80%
java.util.ArrayList$Itr.next()                                                                                                                      326  12.09%
java.util.ArrayList$Itr.hasNext()                                                                                                                   189   7.01%
com.google.common.collect.Iterators$1.next()                                                                                                        183   6.79%
com.google.common.collect.Iterators$1.hasNext()                                                                                                     142   5.27%
net.minecraft.world.level.chunk.PalettedContainer.get(int)                                                                                          108   4.01%
net.minecraft.world.level.BlockCollisions.computeNext()                                                                                              71   2.63%
net.minecraft.world.level.chunk.LevelChunk.getBlockState(BlockPos)                                                                                   65   2.41%
net.minecraft.world.entity.Entity.tick()                                                                                                             60   2.23%
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.get(long)                                                                                           58   2.15%
java.util.ArrayList.addAll(Collection)                                                                                                               53   1.97%
net.minecraft.world.level.LevelReader.getChunk(int, int, ChunkStatus)                                                                                31   1.15%
```

</details>

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.get(long)                                                                                           54   8.97%
net.minecraft.world.entity.Entity.tick()                                                                                                             40   6.64%
net.caffeinemc.mods.lithium.common.entity.movement.ChunkAwareBlockCollisionSweeperVoxelShape.<init>(Level, Entity, AABB)                             39   6.48%
net.minecraft.server.level.ServerChunkCache.getChunk(int, int, ChunkStatus, boolean)                                                                 36   5.98%
net.minecraft.server.level.ServerEntity.sendChanges()                                                                                                36   5.98%
net.minecraft.core.BlockPos.betweenClosed(AABB)                                                                                                      34   5.65%
net.minecraft.world.phys.shapes.Shapes.create(double, double, double, double, double, double)                                                        27   4.49%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                               26   4.32%
net.minecraft.world.level.entity.EntitySectionStorage$Anonymous$8bd463eeb1493ce79f3e2caef1941c86.computeNext()                                       23   3.82%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                                17   2.82%
net.minecraft.world.level.entity.EntitySectionStorage.handler$bcb000$lithium$forEachInBox(...)                                                       16   2.66%
net.minecraft.world.entity.Entity.updateFluidInteraction()                                                                                           15   2.49%
```

</details>

## hoppers

50 chains of 20 hoppers (1000 total) moving items between barrels.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `baseline` | 3 | 1.23 (1.19–1.27) | 1.08 (1.05–1.11) | 1.69 (1.67–1.74) | 3.19 (2.68–3.54) | 15.10 (10.78–17.68) | 0 (0–0) |  |
| `lithium` | 3 | 1.07 (0.95–1.13) | 0.95 (0.86–1.01) | 1.47 (1.35–1.55) | 3.31 (2.35–4.46) | 11.71 (6.85–20.45) | 0 (0–0) | -13.0% |

| Stack | itemsDeliveredDuringMeasurement |
|---|---|
| `baseline` | 7500.00 (7500.00–7500.00) |
| `lithium` | 7500.00 (7500.00–7500.00) |

<details><summary>Hot methods: <code>baseline</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.chunk.LevelChunk$RebindableTickingBlockEntityWrapper.isRemoved()                                                           21  15.33%
net.minecraft.world.level.chunk.LevelChunk$BoundTickingBlockEntity.isRemoved()                                                                        9   6.57%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                                7   5.11%
java.util.HashMap.getNode(Object)                                                                                                                     7   5.11%
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.get(long)                                                                                            6   4.38%
net.minecraft.world.level.Level.updateNeighbourForOutputSignal(BlockPos, Block)                                                                       5   3.65%
net.minecraft.world.level.LevelReader.getChunk(int, int, ChunkStatus)                                                                                 4   2.92%
it.unimi.dsi.fastutil.longs.Long2ObjectLinkedOpenHashMap.get(long)                                                                                    4   2.92%
net.minecraft.server.level.ServerLevel.getWorldBorder()                                                                                               3   2.19%
net.minecraft.world.level.block.entity.HopperBlockEntity.tryMoveItems(Level, BlockPos, BlockState, HopperBlockEntity, BooleanSupplier)                3   2.19%
java.lang.invoke.DirectMethodHandle.allocateInstance(Object)                                                                                          3   2.19%
it.unimi.dsi.fastutil.longs.Long2ObjectOpenHashMap.get(long)                                                                                          2   1.46%
```

</details>

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.chunk.LevelChunk$RebindableTickingBlockEntityWrapper.isRemoved()                                                           20  16.00%
net.minecraft.world.level.chunk.LevelChunk$BoundTickingBlockEntity.isRemoved()                                                                       12   9.60%
net.minecraft.server.level.ServerLevel.shouldTickBlocksAt(long)                                                                                       7   5.60%
net.minecraft.world.level.chunk.PalettedContainer.get(int)                                                                                            6   4.80%
net.minecraft.world.level.block.entity.HopperBlockEntity.handler$zpk000$lithium$checkSleepingConditions(...)                                          6   4.80%
net.caffeinemc.mods.lithium.common.hopper.HopperHelper.tryMoveSingleItem(Container, ItemStack, Direction)                                             5   4.00%
java.util.AbstractList$Itr.hasNext()                                                                                                                  4   3.20%
net.minecraft.world.level.block.entity.BlockEntity.setChanged(Level, BlockPos, BlockState)                                                            2   1.60%
com.mojang.serialization.DataResult$Success.flatMap(Function)                                                                                         2   1.60%
it.unimi.dsi.fastutil.longs.Long2ObjectLinkedOpenHashMap.get(long)                                                                                    2   1.60%
net.minecraft.util.SimpleBitStorage.lithium$compact(Palette, Palette, short[])                                                                        2   1.60%
net.minecraft.world.level.Level.updateNeighbourForOutputSignal(BlockPos, Block)                                                                       2   1.60%
```

</details>

## worldgen

Generate 625 new chunks (25x25) far from spawn.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `baseline` | 3 | 6.55 (6.00–6.93) | 3.44 (3.34–3.60) | 21.94 (21.41–22.86) | 53.26 (49.34–58.68) | 179.78 (142.04–249.76) | 525 (478–551) |  |
| `lithium` | 3 | 5.95 (5.57–6.26) | 2.80 (2.57–2.95) | 22.28 (21.63–22.81) | 59.67 (58.02–60.70) | 207.76 (175.84–242.42) | 543 (219–948) | -9.1% |

| Stack | chunksReady | complete | seconds | chunksPerSecond |
|---|---|---|---|---|
| `baseline` | 625.00 (625.00–625.00) | True, True, True | 26.44 (24.95–27.40) | 23.68 (22.81–25.05) |
| `lithium` | 625.00 (625.00–625.00) | True, True, True | 22.40 (21.19–23.77) | 27.96 (26.29–29.49) |

<details><summary>Hot methods: <code>baseline</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.levelgen.synth.GradientNoise.permute(int)                                                                                 517  11.85%
net.minecraft.world.level.levelgen.Aquifer$NoiseBasedAquifer.computeSubstance(int, int, int, double)                                                229   5.25%
net.minecraft.world.level.chunk.LinearPalette.idFor(Object, PaletteResize)                                                                          191   4.38%
net.minecraft.world.level.levelgen.material.rule.SequenceRule.lambda$compile$0(RuleEvaluator[], int, int, int)                                      190   4.35%
net.minecraft.world.level.levelgen.material.rule.ConditionRule.lambda$compile$0(ConditionEvaluator, RuleEvaluator, int, int, int)                   140   3.21%
net.minecraft.world.level.levelgen.material.MaterialRuleContext$LazyYCondition.test()                                                                98   2.25%
net.minecraft.world.level.biome.Climate$RTree$SubTree.search(long[], Climate$RTree$Leaf, Climate$DistanceMetric)                                     98   2.25%
net.minecraft.world.level.levelgen.WorldgenRandom.next(int)                                                                                          94   2.15%
net.minecraft.world.level.levelgen.densityfunction.DensityVolume.indexOfBlock(int, int, int)                                                         93   2.13%
net.minecraft.world.level.material.FluidState.isEmpty()                                                                                              92   2.11%
net.minecraft.world.level.biome.BiomeManager.getBiome(int, int, int)                                                                                 88   2.02%
net.minecraft.world.level.levelgen.densityfunction.op.InterpolatedFunction$Sampler.fillCell(...)                                                     75   1.72%
```

</details>

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.levelgen.synth.GradientNoise.permute(int)                                                                                 501  14.07%
net.minecraft.world.level.levelgen.Aquifer$NoiseBasedAquifer.computeSubstance(int, int, int, double)                                                196   5.50%
net.minecraft.world.level.levelgen.material.rule.SequenceRule.lambda$compile$0(RuleEvaluator[], int, int, int)                                      145   4.07%
net.minecraft.world.level.levelgen.material.rule.ConditionRule.lambda$compile$0(ConditionEvaluator, RuleEvaluator, int, int, int)                   135   3.79%
net.minecraft.world.level.chunk.PalettedContainer.getAndSet(int, Object)                                                                            108   3.03%
net.minecraft.world.level.levelgen.NoiseBasedChunkGenerator.doFill(NoiseChunk, ChunkAccess)                                                         104   2.92%
net.minecraft.world.level.levelgen.material.MaterialRuleContext$LazyYCondition.test()                                                                92   2.58%
net.minecraft.world.level.levelgen.densityfunction.op.InterpolatedFunction$Sampler.fillCell(...)                                                     82   2.30%
net.minecraft.world.level.chunk.ProtoChunk.setBlockState(BlockPos, BlockState, int)                                                                  74   2.08%
net.minecraft.world.level.levelgen.densityfunction.DensityVolume.indexOfBlock(int, int, int)                                                         69   1.94%
net.minecraft.world.level.biome.Climate$RTree$SubTree.search(long[], Climate$RTree$Leaf, Climate$DistanceMetric)                                     69   1.94%
net.minecraft.world.level.biome.BiomeManager.getBiome(int, int, int)                                                                                 63   1.77%
```

</details>
