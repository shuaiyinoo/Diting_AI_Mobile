package com.diting.mobile;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * ⚠️ 这里【故意不再干预 edge-to-edge】。
     *
     * 背景：
     * 早期版本在此调用 WindowCompat.setDecorFitsSystemWindows(getWindow(), true)，
     * 试图让系统为状态栏 / 导航栏预留空间。但该 API 在 Android 15（API 35）起
     * 被系统忽略 —— Google 强制 edge-to-edge，应用必须自己避让。
     * 本项目 targetSdk=36（Android 16），该调用已完全无效。
     *
     * 现在的方案（Capacitor 8 官方推荐）：
     *   保持 edge-to-edge，由 SystemBars 插件（bundled in @capacitor/core，
     *   insetsHandling 默认 'css'）把真实 inset 注入到 CSS 变量
     *   --safe-area-inset-top / bottom / left / right，
     *   前端在 src/assets/styles/main.css 里优先读这些变量、env() 作 iOS 兜底：
     *
     *     padding-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
     *
     * 好处：
     *   - 不硬编码状态栏高度，适配所有机型 / 屏幕密度 / 挖孔形态
     *   - Android 与 iOS 行为一致，一套 CSS 通吃
     *   - 无需额外插件，无需原生代码
     */
}
