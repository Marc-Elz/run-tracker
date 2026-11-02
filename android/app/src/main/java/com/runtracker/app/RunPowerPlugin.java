package com.runtracker.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebView;
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

    private AudioFocusRequest focusRequest;
    private boolean keepWebViewAlive = false;

    /**
     * While a run is on, keeps the WebView running with the screen off. Android otherwise freezes
     * the page's JavaScript about a minute after the screen goes off, which stalls the run timer,
     * GPS fix handling and the spoken cues. The same workaround cordova-plugin-background-mode uses.
     */
    @PluginMethod
    public void setKeepWebViewAlive(PluginCall call) {
        keepWebViewAlive = Boolean.TRUE.equals(call.getBoolean("keep", false));
        if (keepWebViewAlive) keepAlive();
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (keepWebViewAlive) keepAlive();
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        if (keepWebViewAlive) keepAlive();
    }

    /** Runs after the activity has paused, so the system's own pause doesn't win. */
    private void keepAlive() {
        new Handler(Looper.getMainLooper()).postDelayed(
            () -> {
                if (!keepWebViewAlive) return;
                WebView webView = getBridge().getWebView();
                webView.onResume();
                webView.resumeTimers();
                webView.dispatchWindowVisibilityChanged(View.VISIBLE);
            },
            500
        );
    }

    /** Asks other apps (music) to lower their volume while a spoken cue plays. */
    @PluginMethod
    public void requestAudioFocus(PluginCall call) {
        // AudioFocusRequest needs API 26; on older phones the cue is spoken without ducking
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .build();
        audio.requestAudioFocus(focusRequest);
        call.resolve();
    }

    /** Lets other apps return to full volume. */
    @PluginMethod
    public void abandonAudioFocus(PluginCall call) {
        if (focusRequest != null) {
            AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            audio.abandonAudioFocusRequest(focusRequest);
            focusRequest = null;
        }
        call.resolve();
    }

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
