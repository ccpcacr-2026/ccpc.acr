package com.ccpc.facultyportal;

import android.graphics.Color;
import android.os.Bundle;
import android.view.ViewGroup;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Apps targeting API 35+ are forced edge-to-edge - Window.setDecorFits-
        // SystemWindows(true) is a documented no-op at this target level (confirmed:
        // had zero effect here). View.setPadding() on the WebView itself is also a
        // no-op for its actual content/viewport size (confirmed via uiautomator:
        // bounds stayed full-screen either way). The one thing that DOES resize the
        // WebView's measured bounds - and therefore its page viewport - is a real
        // layout MARGIN, since that changes what the parent allocates to it.
        ViewCompat.setOnApplyWindowInsetsListener(getBridge().getWebView(), (view, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
            params.topMargin = systemBars.top;
            params.bottomMargin = systemBars.bottom;
            params.leftMargin = systemBars.left;
            params.rightMargin = systemBars.right;
            view.setLayoutParams(params);
            return insets;
        });
        // The margin above leaves a gap where the status/nav bars sit - on a
        // forced-edge-to-edge window (API 35+) that gap is otherwise whatever's
        // behind the WebView, which defaults to black. Window.setStatusBarColor()
        // and the Capacitor StatusBar plugin's setBackgroundColor() are BOTH
        // documented no-ops once an app is edge-to-edge (confirmed here: the JS
        // call fired successfully - window.Capacitor.Plugins.StatusBar was
        // present - with zero visible effect). Painting the decor view itself is
        // what actually shows through that transparent system-bar gap.
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#f6e3bf"));
        // Belt-and-braces: try the classic Window APIs too, empirically -
        // "deprecated for edge-to-edge" in Google's docs doesn't always mean
        // "ignored" on every OEM skin, and this device is Samsung/OneUI.
        getWindow().setStatusBarColor(Color.parseColor("#f6e3bf"));
        getWindow().setNavigationBarColor(Color.parseColor("#f6e3bf"));
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(true); // dark icons, for a light bar
        controller.setAppearanceLightNavigationBars(true);
    }
}
