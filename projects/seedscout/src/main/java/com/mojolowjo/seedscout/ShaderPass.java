package com.mojolowjo.seedscout;

import java.lang.reflect.Method;

/**
 * With Oculus (Iris) and a shader pack that has shadows, the level is rendered a second time from the sun, and
 * RenderLevelStageEvent fires in that pass too; boxes drawn there show up as a distorted ghost copy. Iris's API
 * says when the shadow pass is on. Read by reflection, so Oculus is not a dependency.
 */
final class ShaderPass {
    private ShaderPass() {}

    private static Object api;
    private static Method isShadow;
    private static boolean looked;

    static boolean isShadowPass() {
        if (!looked) {
            looked = true;
            try {
                Class<?> c = Class.forName("net.irisshaders.iris.api.v0.IrisApi");
                api = c.getMethod("getInstance").invoke(null);
                isShadow = c.getMethod("isRenderingShadowPass");
            } catch (Throwable t) {
                api = null;
                isShadow = null;
            }
        }
        if (isShadow == null) return false;
        try {
            return (Boolean) isShadow.invoke(api);
        } catch (Throwable t) {
            return false;
        }
    }
}
