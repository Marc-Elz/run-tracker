package com.runtracker.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * What a run needs from Android beyond location: the battery optimisation exemption (so the
 * system doesn't kill the app mid-run) and the notification permission for the foreground
 * service notification (Android 13+).
 */
@CapacitorPlugin(
    name = "RunPower",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class RunPowerPlugin extends Plugin {

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        call.resolve(batteryResult());
    }

    /** Shows the system "Allow" dialog; resolves once it has closed. */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (isIgnoring()) {
            call.resolve(batteryResult());
            return;
        }
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "batteryDialogClosed");
    }

    /** Opens the system battery optimisation list, where the exemption can be removed again. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @ActivityCallback
    private void batteryDialogClosed(PluginCall call, ActivityResult result) {
        call.resolve(batteryResult());
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || notificationsGranted()) {
            call.resolve(notificationResult());
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsAnswered");
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        call.resolve(notificationResult());
    }

    private boolean isIgnoring() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private boolean notificationsGranted() {
        return getPermissionState("notifications") == PermissionState.GRANTED;
    }

    private JSObject batteryResult() {
        JSObject ret = new JSObject();
        ret.put("ignoring", isIgnoring());
        return ret;
    }

    private JSObject notificationResult() {
        JSObject ret = new JSObject();
        ret.put("granted", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || notificationsGranted());
        return ret;
    }
}
